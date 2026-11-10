package ai.storyfork.content.work

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.ForkRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.`when`
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.json.JsonMapper

/**
 * 공개 작품 검색·랭킹·조회 기록 HTTP 계약을 실제 PostgreSQL로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트의 작품과 공유하므로 각 테스트는 자신이 만든 작품 id만 골라 비교한다.
 * 작가명·작가 검색은 소유자의 Core 최신 닉네임이라 Core는 [names]를 돌려주는 대역이다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class WorkSearchRankingIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    /** Core 닉네임 대역이다. 소유자 id → 최신 닉네임이며, 없는 소유자는 Core에 없는(탈퇴한) 회원이다. */
    private val names: MutableMap<String,String> = ConcurrentHashMap()

    @BeforeEach fun coreNicknames() {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer {call ->
            (call.arguments[0] as Collection<*>).map {it as String}.filter {it in names}.associateWith {names.getValue(it)}
        }
    }

    private fun actor(): UUID=UUID.randomUUID().also { id -> `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id)) }
    private fun send(request: HttpRequest.Builder): HttpResponse<String> = client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    private fun get(path: String)=send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json"))
    private fun recordView(work: String,number: Int,member: UUID?,csrf: Boolean=true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port/api/v1/works/$work/episodes/$number/views")).POST(HttpRequest.BodyPublishers.noBody())
        if(csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return send(request)
    }
    private fun encoded(text: String)=URLEncoder.encode(text,Charsets.UTF_8)
    private fun items(path: String): List<tools.jackson.databind.JsonNode> {
        val response=get(path)
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body()).toList()
    }
    private fun ids(path: String)=items(path).map {it.path("id").asText()}
    private fun count(work: String)=jdbc.queryForObject("SELECT count(*) FROM work_view WHERE work_id=?",Int::class.java,work)!!
    private fun work(title: String,genres: List<String> = listOf("판타지"),tags: List<String> = emptyList(),publish: Boolean = true,owner: String = "author"): String {
        val id=works.create(owner,CreateWorkRequest(title,"소개","ORIGINAL",genres,tags,true)).id
        if(publish) {
            val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
            driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        }
        return id
    }
    private fun seedViews(work: String,vararg hoursAgo: Int) = hoursAgo.forEachIndexed { index,hours ->
        jdbc.update("INSERT INTO work_view(work_id,episode_number,member_id,view_date,viewed_at) VALUES (?,1,?,current_date,now() - ? * interval '1 hour')",work,"seed-$index",hours)
    }

    @Test fun `search filters public works by title tag and genre and orders by recent views`() {
        val moon=work("달빛 정원",listOf("판타지"),listOf("회귀"))
        val star=work("별빛 서점",listOf("로맨스"),listOf("#달빛"))
        val hidden=work("달빛 비공개",publish=false)
        val mine=setOf(moon,star,hidden)
        fun found(query: String?)=ids("/api/v1/public/works"+(query?.let {"?$it"} ?: "")).filter {it in mine}

        assertEquals(listOf(star,moon),found(null))
        assertEquals(listOf(star,moon),found("q=${encoded("달빛")}"))
        assertEquals(listOf(star,moon),found("f=all&q=${encoded("달빛")}"))
        assertEquals(listOf(moon),found("f=title&q=${encoded("달빛")}"))
        assertEquals(listOf(star),found("f=tag&q=${encoded("#달빛")}"))
        assertEquals(listOf(star),found("f=genre&q=${encoded("로맨스")}"))
        assertEquals(emptyList<String>(),found("q=${encoded("없는검색어")}"))

        val readers=List(2) {actor()}
        readers.forEach {assertEquals(204,recordView(moon,1,it).statusCode())}
        assertEquals(204,recordView(star,1,readers[0]).statusCode())
        assertEquals(listOf(moon,star),found("sort=view"))
        assertEquals(listOf(star,moon),found("sort=latest"))
        val views=items("/api/v1/public/works?sort=view").associate {it.path("id").asText() to it.path("views").asLong()}
        assertEquals(2L,views[moon])
        assertEquals(1L,views[star])

        assertEquals(422,get("/api/v1/public/works?f=body").statusCode())
        assertEquals(422,get("/api/v1/public/works?sort=popular").statusCode())
    }

    @Test fun `ranking counts the last 24 hours against the 24 hours before`() {
        val surge=work("급상승 작품")
        val steady=work("꾸준한 작품")
        val fading=work("식어가는 작품")
        val idle=work("지난 작품")
        seedViews(surge,1,2,3)
        seedViews(steady,1,2,3,4,5,25,26,27,28,29)
        seedViews(fading,1,25,26,27,28,29,30)
        seedViews(idle,25,26,27,28,50)
        val mine=setOf(surge,steady,fading,idle)
        fun ranked(kind: String)=ids("/api/v1/public/works/ranking?kind=$kind").filter {it in mine}

        assertEquals(listOf(steady,surge,fading),ranked("top"))
        assertEquals(listOf(surge),ranked("rising"))
        assertTrue(ids("/api/v1/public/works/ranking?kind=top").size<=10)
        assertEquals(5L,items("/api/v1/public/works/ranking?kind=top").first {it.path("id").asText()==steady}.path("views").asLong())
        assertEquals(422,get("/api/v1/public/works/ranking?kind=daily").statusCode())
        assertEquals(400,get("/api/v1/public/works/ranking").statusCode())
    }

    @Test fun `view recording is once per member episode and day and only for public published episodes`() {
        val open=work("조회 기록 공개")
        val draftOnly=work("조회 기록 비공개",publish=false)
        val reader=actor()
        val other=actor()

        assertEquals(204,recordView(open,1,reader).statusCode())
        assertEquals(204,recordView(open,1,reader).statusCode())
        assertEquals(1,count(open))
        assertEquals(204,recordView(open,1,other).statusCode())
        assertEquals(2,count(open))

        val third=actor()
        jdbc.update("INSERT INTO work_view(work_id,episode_number,member_id,view_date,viewed_at) VALUES (?,1,?,date '2000-01-01',now() - interval '1 day')",open,third.toString())
        assertEquals(204,recordView(open,1,third).statusCode())
        assertEquals(4,count(open))

        assertEquals(404,recordView(open,2,reader).statusCode())
        assertEquals(404,recordView(open,0,reader).statusCode())
        assertEquals(404,recordView(draftOnly,1,reader).statusCode())
        assertEquals(404,recordView(UUID.randomUUID().toString(),1,reader).statusCode())
        assertEquals(401,recordView(open,1,null).statusCode())
        assertEquals(403,recordView(open,1,reader,csrf=false).statusCode())
        assertEquals(0,count(draftOnly))
        assertEquals(4,count(open))
    }

    @Test fun `author search and author names follow the owner's latest Core nickname`() {
        val tag=UUID.randomUUID().toString().take(8)
        val writer="writer-$tag"
        names[writer]="작가-$tag"
        val first=work("작가 검색 하나",owner=writer)
        // Core에 없는 소유자의 작품은 작가명이 탈퇴한 회원이다.
        val second=work("작가 검색 둘",owner="gone-$tag")
        val hidden=work("작가 검색 비공개",owner=writer,publish=false)
        val mine=setOf(first,second,hidden)
        fun found(query: String)=ids("/api/v1/public/works?$query").filter {it in mine}
        fun nameOf(id: String)=items("/api/v1/public/works").first {it.path("id").asText()==id}.path("authorName").asText()

        assertEquals(listOf(first),found("f=author&q=${encoded("작가-$tag")}"))
        assertEquals(listOf(first),found("f=all&q=${encoded("작가-$tag")}"))
        assertEquals(emptyList<String>(),found("f=title&q=${encoded("작가-$tag")}"))
        assertEquals("작가-$tag",nameOf(first))
        assertEquals("탈퇴한 회원",nameOf(second))

        // 닉네임을 바꾸면 검색·목록·상세가 바로 따라간다. Content에 저장된 작가명은 읽지 않는다.
        names[writer]="바뀐-$tag"
        assertEquals(emptyList<String>(),found("f=author&q=${encoded("작가-$tag")}"))
        assertEquals(listOf(first),found("f=author&q=${encoded("바뀐-$tag")}"))
        assertEquals("바뀐-$tag",nameOf(first))
        assertEquals("바뀐-$tag",json.readTree(get("/api/v1/public/works/$first").body()).path("authorName").asText())
    }

    // ---- 기능 45: 기간별 랭킹·인기 추이(GET /api/v1/public/works/rankings) ----

    private fun board(query: String): tools.jackson.databind.JsonNode {
        val response=get("/api/v1/public/works/rankings?$query")
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body())
    }
    private fun cards(query: String): List<tools.jackson.databind.JsonNode> = board(query).path("items").toList()
    /** 응답 순서를 지키되 이 테스트가 만든 작품만 남긴다(DB는 다른 테스트와 공유). 50개를 받아 다른 작품에 밀리지 않게 한다. */
    private fun rankedMine(query: String,mine: Set<String>) = cards("$query&limit=50").map {it.path("id").asString()}.filter {it in mine}
    private fun seedLikes(work: String,vararg hoursAgo: Int) = hoursAgo.forEachIndexed {index,hours ->
        jdbc.update("INSERT INTO work_like(work_id,member_id,created_at) VALUES (?,?,now() - ? * interval '1 hour')",work,"liker-$index-${UUID.randomUUID()}",hours)
    }
    private fun publishNext(id: String,owner: String,title: String) {
        val draft=driver.edit(id,owner,DraftRequest(title,"본문",driver.read(id,owner).draft!!.revision))
        driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
    }

    @Test fun `rankings echo the applied options and a computation time and reject bad options`() {
        val before=Instant.now()
        val defaults=board("kind=view")
        assertEquals(listOf("view","day","all"),listOf("kind","period","type").map {defaults.path(it).asString()})
        assertTrue(defaults.path("items").isArray)
        assertTrue(Duration.between(before,Instant.parse(defaults.path("computedAt").asString())).abs()<Duration.ofMinutes(1))
        val given=board("kind=popular&period=month&type=fork&limit=5")
        assertEquals(listOf("popular","month","fork"),listOf("kind","period","type").map {given.path(it).asString()})
        assertTrue(given.path("items").size()<=5)

        for(bad in listOf("kind=top","kind=daily","kind=VIEW","kind=view&period=year","kind=view&period=DAY","kind=view&type=forks","kind=view&limit=0","kind=view&limit=51","kind=view&limit=abc","kind=view&limit=")) {
            assertEquals(422,get("/api/v1/public/works/rankings?$bad").statusCode(),bad)
        }
        // kind는 필수다. 기존 /ranking과 같이 누락은 400이다.
        assertEquals(400,get("/api/v1/public/works/rankings").statusCode())
    }

    @Test fun `rankings view and rising count the views inside the requested period`() {
        val today=work("기간 조회 오늘")
        val thisWeek=work("기간 조회 이번 주")
        val thisMonth=work("기간 조회 이번 달")
        val tieOlder=work("기간 조회 동점 먼저")
        val tieNewer=work("기간 조회 동점 나중")
        seedViews(today,1,2,3)
        seedViews(thisWeek,30,40,50,60)
        seedViews(thisMonth,240,250,260,270,280)
        seedViews(tieOlder,5,6)
        seedViews(tieNewer,7,8)
        val mine=setOf(today,thisWeek,thisMonth,tieOlder,tieNewer)

        // 동점(둘째·셋째)은 작품 생성 최신순이다.
        assertEquals(listOf(today,tieNewer,tieOlder),rankedMine("kind=view",mine))
        assertEquals(listOf(thisWeek,today,tieNewer,tieOlder),rankedMine("kind=view&period=week",mine))
        assertEquals(listOf(thisMonth,thisWeek,today,tieNewer,tieOlder),rankedMine("kind=view&period=month",mine))
        // 급상승은 기간 조회 수 − 바로 앞 같은 길이 기간 조회 수이고 0 이하는 빠진다(이번 주 작품은 하루 기준 증가분이 -2, 이번 달 작품은 주 기준 -5).
        assertEquals(listOf(today,tieNewer,tieOlder),rankedMine("kind=rising",mine))
        assertEquals(listOf(thisWeek,today,tieNewer,tieOlder),rankedMine("kind=rising&period=week",mine))
        assertEquals(listOf(thisMonth,thisWeek,today,tieNewer,tieOlder),rankedMine("kind=rising&period=month",mine))

        val weekViews=cards("kind=view&period=week&limit=50").associate {it.path("id").asString() to it.path("views").asLong()}
        assertEquals(listOf(4L,3L,2L,2L),listOf(thisWeek,today,tieOlder,tieNewer).map {weekViews[it]})
        assertEquals(5L,cards("kind=view&period=month&limit=50").first {it.path("id").asString()==thisMonth}.path("views").asLong())
    }

    @Test fun `rankings popular counts the likes pressed inside the period and breaks ties by period views then newest`() {
        val hot=work("인기 하루")
        val warm=work("인기 이번 주")
        val retired=work("인기 지난 달")
        val tieHigh=work("인기 동점 조회 많음")
        val tieOlder=work("인기 동점 먼저")
        val tieNewer=work("인기 동점 나중")
        seedLikes(hot,1,2,3,24*40)
        seedLikes(warm,50,60)
        seedLikes(retired,24*40,24*41)
        seedLikes(tieHigh,1)
        seedLikes(tieOlder,2)
        seedLikes(tieNewer,3)
        seedViews(tieHigh,1,2,3)
        seedViews(tieOlder,1)
        seedViews(tieNewer,1)
        val mine=setOf(hot,warm,retired,tieHigh,tieOlder,tieNewer)

        assertEquals(listOf(hot,tieHigh,tieNewer,tieOlder),rankedMine("kind=popular",mine))
        assertEquals(listOf(hot,warm,tieHigh,tieNewer,tieOlder),rankedMine("kind=popular&period=week",mine))
        assertEquals(listOf(hot,warm,tieHigh,tieNewer,tieOlder),rankedMine("kind=popular&period=month",mine))
        // likes는 기간이 아니라 전체 공개 좋아요 수(40일 전 1건 포함)이고 views는 그 기간의 조회 수다.
        val first=cards("kind=popular&limit=50").first {it.path("id").asString()==hot}
        assertEquals(listOf(4L,0L),listOf(first.path("likes").asLong(),first.path("views").asLong()))
    }

    @Test fun `rankings latest orders by creation and updated by the last publication and only updated fills updatedAt`() {
        val writer="writer-${UUID.randomUUID().toString().take(8)}"
        names[writer]="랭킹작가-$writer"
        val first=work("목록 먼저",owner=writer)
        val second=work("목록 나중")
        val draft=work("목록 비공개",publish=false)
        publishNext(first,writer,"2화")
        val mine=setOf(first,second,draft)

        assertEquals(listOf(second,first),rankedMine("kind=latest",mine))
        assertEquals(listOf(first,second),rankedMine("kind=updated",mine))
        assertEquals(listOf(first,second),rankedMine("kind=updated&period=month",mine))
        val updated=cards("kind=updated&limit=50").filter {it.path("id").asString() in mine}
        val stamps=updated.map {Instant.parse(it.path("updatedAt").asString())}
        assertTrue(stamps[0]>stamps[1])
        assertEquals("랭킹작가-$writer",updated.first().path("authorName").asString())
        assertTrue(cards("kind=latest&limit=50").all {it.path("updatedAt").isNull})
        assertTrue(cards("kind=view&limit=50").all {it.path("updatedAt").isNull})
    }

    @Test fun `rankings type ranks originals and forks separately before the limit is applied`() {
        val original=work("범위 원작")
        val forkOwner="fork-owner-${UUID.randomUUID()}"
        val fork=driver.fork(original,forkOwner,ForkRequest(1,"범위 포크")).id
        publishNext(fork,forkOwner,"포크 2화")
        val newest=work("범위 가장 최신 원작")
        seedViews(original,1,2,3)
        seedViews(fork,1)
        val mine=setOf(original,fork,newest)

        assertEquals(listOf(original,fork),rankedMine("kind=view",mine))
        assertEquals(listOf(original),rankedMine("kind=view&type=original",mine))
        assertEquals(listOf(fork),rankedMine("kind=view&type=fork",mine))
        assertEquals(listOf(newest,fork,original),rankedMine("kind=latest",mine))
        assertEquals(listOf(fork),rankedMine("kind=latest&type=fork",mine))
        // 전체 최신 1개는 원작이어도 Fork 최신 1개는 Fork다(상위 N개를 자른 뒤 거르지 않는다).
        fun top(query: String)=cards("$query&limit=1").map {it.path("id").asString()}
        assertEquals(listOf(newest),top("kind=latest"))
        assertEquals(listOf(fork),top("kind=latest&type=fork"))
        assertEquals(listOf(newest),top("kind=latest&type=original"))
    }

    @Test fun `rankings leave out private and restricted works before the limit is applied`() {
        val open=work("공개 랭킹")
        val blocked=work("제한 랭킹")
        val draft=work("비공개 랭킹",publish=false)
        seedViews(blocked,1,2,3,4)
        seedViews(draft,1,2,3)
        seedViews(open,1)
        seedLikes(blocked,1,2)
        seedLikes(open,1)
        jdbc.update("UPDATE work SET restricted=true WHERE id=?",blocked)
        val mine=setOf(open,blocked,draft)

        for(kind in listOf("view","rising","popular","latest","updated")) assertEquals(listOf(open),rankedMine("kind=$kind",mine),kind)
        // 가장 최근에 만들어진·갱신된 작품이 제한·비공개여도 limit=1은 그 뒤의 공개 작품을 돌려준다.
        assertEquals(listOf(open),cards("kind=latest&limit=1").map {it.path("id").asString()})
        assertEquals(listOf(open),cards("kind=updated&limit=1").map {it.path("id").asString()})
        jdbc.update("UPDATE work SET restricted=false WHERE id=?",blocked)
    }
}
