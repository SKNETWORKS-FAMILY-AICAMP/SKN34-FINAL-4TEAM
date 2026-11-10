package ai.storyfork.content.work

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
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
    @Autowired lateinit var likes: WorkLikeService
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

    @Test fun `like sort orders by public likes and page and size cut the sorted result`() {
        // 제목에 넣은 고유 토큰으로 검색해 다른 테스트의 작품이 페이지에 섞이지 않게 한다.
        val tag=UUID.randomUUID().toString().take(8)
        val first=work("인기 $tag 하나")
        val second=work("인기 $tag 둘")
        val third=work("인기 $tag 셋")
        work("인기 $tag 비공개",publish=false)
        likes.like(first,"fan-1")
        likes.like(first,"fan-2")
        likes.like(second,"fan-1")
        val query="/api/v1/public/works?f=title&q=${encoded(tag)}"

        assertEquals(listOf(third,second,first),ids(query))
        assertEquals(listOf(first,second,third),ids("$query&sort=like"))
        assertEquals(listOf(2L,1L,0L),items("$query&sort=like").map {it.path("likes").asLong()})
        assertEquals(listOf(first,second),ids("$query&sort=like&page=0&size=2"))
        assertEquals(listOf(third),ids("$query&sort=like&page=1&size=2"))
        assertEquals(emptyList<String>(),ids("$query&sort=like&page=2&size=2"))
        // 하나만 오면 나머지는 기본값(page 0, size 20)이다.
        assertEquals(listOf(third,second),ids("$query&size=2"))
        assertEquals(listOf(third,second,first),ids("$query&page=0"))
        assertEquals(emptyList<String>(),ids("$query&page=1"))
        // 숫자 아닌 값도 400이 아니라 422다.
        for(bad in listOf("page=-1","page=abc","size=0","size=101","size=abc","page=1.5")) assertEquals(422,get("$query&$bad").statusCode(),bad)
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
}
