package ai.storyfork.content.comment

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
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
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * 회차 댓글 HTTP 계약(경로·Security·CSRF·상태 코드·Location)과 V17 저장을 실제 PostgreSQL로 검증한다.
 * 작성자 표시명의 정본은 Core 닉네임이라 Content에는 저장하지 않으며, Core는 [names]를 돌려주는 대역이다.
 * TEST_CONTENT_DATABASE_URL이 있을 때만 실행하며, DB는 다른 테스트와 공유하므로 각 테스트는 자신이 만든 작품의 행만 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class EpisodeCommentPostgresTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    /** Core 닉네임 대역이다. 회원 id → 최신 닉네임이며, 없는 회원은 Core에 없는(탈퇴한) 회원이다. */
    private val names: MutableMap<String,String> = ConcurrentHashMap()

    @BeforeEach fun coreNicknames() {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer {call ->
            (call.arguments[0] as Collection<*>).map {it as String}.filter {it in names}.associateWith {names.getValue(it)}
        }
    }

    /** Core가 확인해 주는 회원이다. 닉네임을 주면 Core 닉네임 대역에도 등록한다. */
    private fun member(nickname: String? = "닉네임"): UUID=UUID.randomUUID().also { id ->
        `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id))
        if(nickname!=null) names[id.toString()]=nickname
    }
    private fun call(method: String,path: String,member: UUID? = null,body: String? = null,csrf: Boolean = true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
            .method(method,if(body==null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body))
        if(body!=null) request.header("Content-Type","application/json")
        if(method!="GET" && csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun write(id: String,number: Int = 1)="/api/v1/works/$id/episodes/$number/comments"
    private fun read(id: String,number: Int = 1)="/api/v1/public/works/$id/episodes/$number/comments"
    private fun post(id: String,member: UUID?,body: String,number: Int = 1)=call("POST",write(id,number),member,body)
    private fun detail(id: String,comment: String,member: UUID? = null)=call("GET","${read(id)}/$comment",member)
    private fun list(id: String,sort: String? = null,member: UUID? = null)=call("GET",read(id)+(sort?.let {"?sort=$it"} ?: ""),member)
    private fun node(response: HttpResponse<String>): JsonNode=json.readTree(response.body())
    private fun ids(response: HttpResponse<String>)=node(response).path("items").toList().map {it.path("id").asString()}
    private fun created(response: HttpResponse<String>): String {
        assertEquals(201,response.statusCode(),response.body())
        return node(response).path("id").asString()
    }
    private fun count(sql: String,vararg args: Any)=jdbc.queryForObject(sql,Int::class.java,*args)!!
    private fun publishedVersion(work: String)=jdbc.queryForObject("SELECT published_version_id FROM episode_current WHERE work_id=? AND sequence=1",String::class.java,work)!!

    private fun work(owner: String = "author",publish: Boolean = true): String {
        val id=works.create(owner,CreateWorkRequest("댓글 테스트","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        if(publish) {
            val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
            driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        }
        return id
    }

    @Test fun `comment lifecycle stores a fixed version and no name and soft deletes`() {
        val owner=member("작가")
        val id=work(owner.toString())
        val author=member("닉네임")
        val other=member("다른 독자")

        val response=post(id,author,"""{"body":"  재밌어요  ","quote":"선택한 문장","spoiler":true}""")
        val cid=created(response)
        assertEquals("${read(id)}/$cid",response.headers().firstValue("Location").orElse(null))
        val version=publishedVersion(id)
        val body=node(response)
        assertEquals(listOf<Any?>(id,1,version,"닉네임","재밌어요","선택한 문장",true,0,false,true,false),
            listOf(body.path("workId").asString(),body.path("episodeNumber").asInt(),body.path("publishedVersionId").asString(),body.path("authorName").asString(),
                body.path("body").asString(),body.path("quote").asString(),body.path("spoiler").asBoolean(),body.path("likeCount").asInt(),
                body.path("liked").asBoolean(),body.path("mine").asBoolean(),body.path("edited").asBoolean()))
        Instant.parse(body.path("createdAt").asString())
        Instant.parse(body.path("updatedAt").asString())
        assertEquals(version,jdbc.queryForObject("SELECT published_version_id FROM episode_comment WHERE id=?",String::class.java,cid))
        // 작성자 이름은 저장하지 않는다. 응답 때마다 Core 닉네임을 조회한다.
        assertEquals(0,count("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='episode_comment' AND column_name='author_name'"))

        // 익명도 상세·목록을 볼 수 있고 mine은 Bearer 회원 기준이다.
        val anonymous=detail(id,cid)
        assertEquals(200,anonymous.statusCode(),anonymous.body())
        assertEquals(listOf(false,false),node(anonymous).let {listOf(it.path("mine").asBoolean(),it.path("liked").asBoolean())})
        assertEquals(listOf(cid),ids(list(id)))
        assertTrue(node(detail(id,cid,author)).path("mine").asBoolean())
        assertFalse(node(detail(id,cid,other)).path("mine").asBoolean())

        // 작품 소유자도 자기 작품에 댓글을 쓸 수 있지만 남의 댓글은 고치거나 지울 수 없다.
        created(post(id,owner,"""{"body":"작가의 댓글"}"""))
        for(who in listOf(other,owner)) {
            assertEquals(403,call("PUT","${write(id)}/$cid",who,"""{"body":"가로채기","spoiler":false}""").statusCode())
            assertEquals(403,call("DELETE","${write(id)}/$cid",who).statusCode())
        }

        val edited=call("PUT","${write(id)}/$cid",author,"""{"body":"고친 글","spoiler":false}""")
        assertEquals(200,edited.statusCode(),edited.body())
        assertEquals(listOf<Any?>("고친 글",false,"선택한 문장",version,true),
            node(edited).let {listOf(it.path("body").asString(),it.path("spoiler").asBoolean(),it.path("quote").asString(),it.path("publishedVersionId").asString(),it.path("edited").asBoolean())})
        assertEquals("고친 글",jdbc.queryForObject("SELECT body FROM episode_comment WHERE id=?",String::class.java,cid))

        assertEquals(204,call("DELETE","${write(id)}/$cid",author).statusCode())
        assertEquals(1,count("SELECT count(*) FROM episode_comment WHERE id=? AND deleted_at IS NOT NULL",cid))
        assertEquals(404,detail(id,cid).statusCode())
        assertFalse(cid in ids(list(id)))
        assertEquals(404,call("PUT","${write(id)}/$cid",author,"""{"body":"다시","spoiler":false}""").statusCode())
        assertEquals(404,call("DELETE","${write(id)}/$cid",author).statusCode())
        assertEquals(404,call("PUT","${write(id)}/$cid/like",other).statusCode())
        assertEquals(404,call("DELETE","${write(id)}/$cid/like",other).statusCode())
    }

    @Test fun `likes are idempotent per member and sort by count then newest`() {
        val id=work()
        val author=member()
        val fans=List(3) {member()}
        val older=created(post(id,author,"""{"body":"먼저 쓴 글"}"""))
        val newer=created(post(id,author,"""{"body":"나중에 쓴 글"}"""))

        for(fan in fans.take(2)) repeat(2) {assertEquals(204,call("PUT","${write(id)}/$older/like",fan).statusCode())}
        assertEquals(204,call("PUT","${write(id)}/$newer/like",fans[2]).statusCode())
        assertEquals(2,count("SELECT count(*) FROM episode_comment_like WHERE comment_id=?",older))

        assertEquals(listOf(newer,older),ids(list(id)))
        assertEquals(listOf(newer,older),ids(list(id,"latest")))
        assertEquals(listOf(older,newer),ids(list(id,"likes")))
        val asFan=node(list(id,"likes",fans[0])).path("items").toList()
        assertEquals(listOf(2,true,1,false),listOf(asFan[0].path("likeCount").asInt(),asFan[0].path("liked").asBoolean(),asFan[1].path("likeCount").asInt(),asFan[1].path("liked").asBoolean()))
        assertTrue(node(list(id,"likes")).path("items").toList().none {it.path("liked").asBoolean()})

        repeat(2) {assertEquals(204,call("DELETE","${write(id)}/$older/like",fans[0]).statusCode())}
        assertEquals(204,call("DELETE","${write(id)}/$older/like",author).statusCode())
        assertEquals(1,count("SELECT count(*) FROM episode_comment_like WHERE comment_id=?",older))
        assertFalse(node(detail(id,older,fans[0])).path("liked").asBoolean())
        assertEquals(1,node(detail(id,older)).path("likeCount").asInt())

        val missing=UUID.randomUUID()
        assertEquals(404,call("PUT","${write(id)}/$missing/like",fans[0]).statusCode())
        assertEquals(404,call("DELETE","${write(id)}/$missing/like",fans[0]).statusCode())
        assertEquals(401,call("PUT","${write(id)}/$older/like").statusCode())
        assertEquals(403,call("PUT","${write(id)}/$older/like",fans[0],csrf=false).statusCode())
    }

    @Test fun `invalid input is 422 or 400 and nothing is stored or changed`() {
        val id=work()
        val author=member()
        val tooLong="가".repeat(501)
        for(bad in listOf("""{}""","""{"body":""}""","""{"body":"   "}""","""{"body":"  "}""","""{"body":"$tooLong"}""",
            """{"body":"본문\u0000"}""","""{"body":"본문","quote":"$tooLong"}""","""{"body":"본문","quote":"\u0000"}""")) {
            assertEquals(422,post(id,author,bad).statusCode(),bad.take(40))
        }
        assertEquals(400,post(id,author,"{broken").statusCode())
        assertEquals(0,count("SELECT count(*) FROM episode_comment WHERE work_id=?",id))

        val cid=created(post(id,author,"""{"body":"원래 글","spoiler":true}"""))
        for(bad in listOf("""{"body":"","spoiler":false}""","""{"body":" ","spoiler":false}""","""{"body":"$tooLong","spoiler":false}""","""{"body":"고침\u0000","spoiler":false}""")) {
            assertEquals(422,call("PUT","${write(id)}/$cid",author,bad).statusCode(),bad.take(40))
        }
        assertEquals(listOf<Any?>("원래 글",true),jdbc.queryForObject("SELECT body,spoiler FROM episode_comment WHERE id=?",{rs,_ -> listOf<Any?>(rs.getString(1),rs.getBoolean(2))},cid))
        assertEquals(422,list(id,"popular").statusCode())
        assertEquals(200,list(id,"likes").statusCode())
    }

    @Test fun `the author name follows the latest Core nickname and a member Core no longer knows is the withdrawn member`() {
        val id=work()
        val author=member("처음 닉네임")
        val response=post(id,author,"""{"body":"이름이 바뀌는 독자"}""")
        val cid=created(response)
        assertEquals("처음 닉네임",node(response).path("authorName").asString())

        names[author.toString()]="바꾼 닉네임"
        assertEquals("바꾼 닉네임",node(detail(id,cid)).path("authorName").asString())
        assertEquals(listOf("바꾼 닉네임"),node(list(id)).path("items").toList().map {it.path("authorName").asString()})

        names.remove(author.toString())
        assertEquals("탈퇴한 회원",node(detail(id,cid)).path("authorName").asString())
        val edited=call("PUT","${write(id)}/$cid",author,"""{"body":"고침","spoiler":false}""")
        assertEquals("탈퇴한 회원",node(edited).path("authorName").asString())
        assertEquals("탈퇴한 회원",node(post(id,author,"""{"body":"남긴 글"}""")).path("authorName").asString())
    }

    @Test fun `a Core failure is a 503 and never a made up name or a stored comment`() {
        val id=work()
        val author=member()
        val first=created(post(id,author,"""{"body":"저장된 글"}"""))
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>()))
            .thenThrow(CoreAuthException(503,"CORE_MEMBER_UNAVAILABLE","회원 정보 서비스를 사용할 수 없습니다."))

        for(response in listOf(list(id),detail(id,first),post(id,author,"""{"body":"저장되면 안 되는 글"}"""),
            call("PUT","${write(id)}/$first",author,"""{"body":"고치면 안 되는 글","spoiler":false}"""))) {
            assertEquals(503,response.statusCode(),response.body())
            assertEquals("회원 정보 서비스를 사용할 수 없습니다.",node(response).path("detail").asString())
        }
        // 응답을 만들지 못한 쓰기는 같은 트랜잭션에서 되돌려진다.
        assertEquals(listOf("저장된 글"),jdbc.queryForList("SELECT body FROM episode_comment WHERE work_id=?",String::class.java,id))
        // 좋아요·삭제는 응답에 이름이 없어 Core를 부르지 않는다.
        assertEquals(204,call("PUT","${write(id)}/$first/like",author).statusCode())
        assertEquals(204,call("DELETE","${write(id)}/$first",author).statusCode())
    }

    @Test fun `only published episodes of public works take comments and writing needs a verified member and csrf`() {
        val open=work()
        val hidden=work(publish=false)
        val reader=member()

        assertEquals(200,list(open).statusCode())
        assertEquals(401,post(open,null,"""{"body":"익명"}""").statusCode())
        assertEquals(403,call("POST",write(open),reader,"""{"body":"CSRF 없음"}""",csrf=false).statusCode())
        for((target,number) in listOf(hidden to 1,open to 2,open to 0,UUID.randomUUID().toString() to 1)) {
            assertEquals(404,call("GET",read(target,number)).statusCode(),"read $target $number")
            assertEquals(404,post(target,reader,"""{"body":"안 돼요"}""",number).statusCode(),"write $target $number")
        }
        assertEquals(0,count("SELECT count(*) FROM episode_comment WHERE work_id IN (?,?)",open,hidden))
    }

    @Test fun `a later publication does not change the version an existing comment was written against`() {
        val id=work()
        val reader=member()
        val first=created(post(id,reader,"""{"body":"초판을 읽고"}"""))
        val before=publishedVersion(id)

        val episode=driver.writing(id,"author",1)
        val saved=driver.writeEpisode(id,"author",1,DraftRequest("1화 개정","개정 본문",episode.draft.revision),true)
        driver.publishEpisode(id,"author",1,PublishRequest(saved.draft.revision,true,true,true,saved.versions.last().id))
        val after=publishedVersion(id)
        assertNotEquals(before,after)

        val second=created(post(id,reader,"""{"body":"개정판을 읽고"}"""))
        assertEquals(before,node(detail(id,first)).path("publishedVersionId").asString())
        assertEquals(after,node(detail(id,second)).path("publishedVersionId").asString())
        assertEquals(before,jdbc.queryForObject("SELECT published_version_id FROM episode_comment WHERE id=?",String::class.java,first))
    }

    @Test fun `an operator hidden comment is a placeholder that refuses edit and like with 409 but its author can still delete it`() {
        val id=work()
        val author=member("작성자")
        val fan=member()
        val response=post(id,author,"""{"body":"운영이 숨길 글","quote":"선택 문장","spoiler":true}""")
        val cid=created(response)
        val kept=created(post(id,author,"""{"body":"그대로 보이는 글"}"""))
        assertFalse(node(response).path("hidden").asBoolean())
        assertEquals(204,call("PUT","${write(id)}/$cid/like",fan).statusCode())

        // 운영 숨김은 V24의 hidden 칼럼만 켠다. 원문은 지우지 않는다.
        assertEquals(1,jdbc.update("UPDATE episode_comment SET hidden=true WHERE id=?",cid))

        val placeholders=listOf(node(detail(id,cid,fan)),node(list(id,null,fan)).path("items").toList().single {it.path("id").asString()==cid})
        for(shown in placeholders) {
            assertEquals(listOf<Any?>(true,"",true,"작성자",1,true,true),
                listOf(shown.path("hidden").asBoolean(),shown.path("body").asString(),shown.path("quote").isNull,shown.path("authorName").asString(),
                    shown.path("likeCount").asInt(),shown.path("liked").asBoolean(),shown.path("spoiler").asBoolean()))
        }
        assertEquals(listOf<Any?>("그대로 보이는 글",false),node(detail(id,kept)).let {listOf(it.path("body").asString(),it.path("hidden").asBoolean())})
        assertEquals(listOf<Any?>("운영이 숨길 글","선택 문장"),jdbc.queryForObject("SELECT body,quote FROM episode_comment WHERE id=?",{rs,_ -> listOf<Any?>(rs.getString(1),rs.getString(2))},cid))

        for(refused in listOf(call("PUT","${write(id)}/$cid",author,"""{"body":"고치면 안 되는 글","spoiler":false}"""),
            call("PUT","${write(id)}/$cid/like",author),call("DELETE","${write(id)}/$cid/like",fan))) {
            assertEquals(409,refused.statusCode(),refused.body())
            assertEquals("COMMENT_HIDDEN",node(refused).path("code").asString())
        }
        assertEquals(1,count("SELECT count(*) FROM episode_comment_like WHERE comment_id=?",cid))
        assertEquals("운영이 숨길 글",jdbc.queryForObject("SELECT body FROM episode_comment WHERE id=?",String::class.java,cid))

        // 게시 복구(hidden=false)하면 원문이 그대로 돌아오고, 숨긴 채로도 작성자는 삭제할 수 있다.
        assertEquals(1,jdbc.update("UPDATE episode_comment SET hidden=false WHERE id=?",cid))
        assertEquals("운영이 숨길 글",node(detail(id,cid)).path("body").asString())
        assertEquals(1,jdbc.update("UPDATE episode_comment SET hidden=true WHERE id=?",cid))
        assertEquals(204,call("DELETE","${write(id)}/$cid",author).statusCode())
        assertEquals(404,detail(id,cid).statusCode())
    }
}
