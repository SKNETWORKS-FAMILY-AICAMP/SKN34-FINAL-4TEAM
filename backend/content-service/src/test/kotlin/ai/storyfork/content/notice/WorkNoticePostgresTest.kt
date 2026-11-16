package ai.storyfork.content.notice

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
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
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
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
 * 작품 소식 HTTP 계약(경로·Security·CSRF·상태 코드·Location)과 V36 저장을 실제 PostgreSQL로 검증한다.
 * 운영자는 Core 확인 응답의 operator=true인 회원이며 Core는 [core] 대역이다(작품 생성 응답의 닉네임 조회는 [nicknames] 대역).
 * TEST_CONTENT_DATABASE_URL이 있을 때만 실행하며, DB는 다른 테스트와 공유하므로 각 테스트는 자신이 만든 작품의 행만 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class WorkNoticePostgresTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    // 보이지 않는 문자는 소스에 적지 않고 코드로 만든다.
    private val nbsp=Char(0xA0)

    /** Core가 확인해 주는 회원이다. [operator]면 Core가 운영자(operator=true)로 답한다. */
    private fun member(operator: Boolean = false): UUID=UUID.randomUUID().also {id ->
        `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id,operator))
    }
    private fun call(method: String,path: String,member: UUID? = null,body: String? = null,csrf: Boolean = true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
            .method(method,if(body==null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body))
        if(body!=null) request.header("Content-Type","application/json")
        if(method!="GET" && csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun write(id: String)="/api/v1/works/$id/notices"
    private fun read(id: String)="/api/v1/public/works/$id/notices"
    private fun node(response: HttpResponse<String>): JsonNode=json.readTree(response.body())
    private fun ids(response: HttpResponse<String>)=node(response).path("items").toList().map {it.path("id").asString()}
    private fun created(response: HttpResponse<String>): String {
        assertEquals(201,response.statusCode(),response.body())
        return node(response).path("id").asString()
    }
    private fun count(sql: String,vararg args: Any)=jdbc.queryForObject(sql,Int::class.java,*args)!!
    private fun notice(category: String = "info",title: String = "제목",body: String = "본문",pinned: Boolean = false)=
        """{"category":"$category","title":"$title","body":"$body","pinned":$pinned}"""

    /** 공개 작품이다([publish]가 false면 비공개 작품이다). */
    private fun work(owner: String,publish: Boolean = true): String {
        val id=works.create(owner,CreateWorkRequest("소식 테스트","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        if(publish) {
            val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
            driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        }
        return id
    }

    @Test fun `owner and operator manage notices over HTTP and a delete is a soft delete`() {
        val owner=member()
        val other=member()
        val admin=member(operator=true)
        val id=work(owner.toString())

        // 익명도 공개 작품의 소식 목록을 본다. 처음에는 비어 있다.
        val empty=call("GET",read(id))
        assertEquals(200,empty.statusCode(),empty.body())
        assertEquals(emptyList<String>(),ids(empty))

        // 소유자가 쓰면 201과 소식 경로(Location)가 오고 앞뒤 공백은 잘려 저장된다. 처음 쓴 회원이 author_id다.
        val response=call("POST",write(id),owner,"""{"category":"hiatus","title":"  휴재 안내  ","body":" 다음 주는 쉽니다. ","pinned":false}""")
        val first=created(response)
        assertEquals("${write(id)}/$first",response.headers().firstValue("Location").orElse(null))
        val body=node(response)
        assertEquals(listOf<Any?>(first,id,"hiatus","휴재 안내","다음 주는 쉽니다.",false),
            listOf(body.path("id").asString(),body.path("workId").asString(),body.path("category").asString(),body.path("title").asString(),
                body.path("body").asString(),body.path("pinned").asBoolean()))
        Instant.parse(body.path("createdAt").asString())
        Instant.parse(body.path("updatedAt").asString())
        assertEquals(listOf<Any?>(owner.toString(),"휴재 안내"),
            jdbc.queryForObject("SELECT author_id,title FROM work_notice WHERE id=?",{rs,_ -> listOf<Any?>(rs.getString(1),rs.getString(2))},first))

        // 소유자도 운영자도 아닌 회원은 403, 비로그인은 401, CSRF가 없으면 403이고 아무것도 저장되지 않는다.
        assertEquals(403,call("POST",write(id),other,notice()).statusCode())
        assertEquals(401,call("POST",write(id),null,notice()).statusCode())
        assertEquals(403,call("POST",write(id),owner,notice(),csrf=false).statusCode())
        assertEquals(1,count("SELECT count(*) FROM work_notice WHERE work_id=?",id))

        // 운영자는 남의 작품에도 쓸 수 있고, 목록은 고정이 없으면 최신순이다.
        val second=created(call("POST",write(id),admin,notice("event","이벤트 안내","경품 증정")))
        assertEquals(admin.toString(),jdbc.queryForObject("SELECT author_id FROM work_notice WHERE id=?",String::class.java,second))
        assertEquals(listOf(second,first),ids(call("GET",read(id))))

        // 전체 수정: 타인은 403·CSRF 없음은 403이고, 소유자가 고정하면 오래된 소식도 맨 앞으로 오며 운영자가 해제하면 되돌아간다.
        assertEquals(403,call("PUT","${write(id)}/$first",other,notice(pinned=true)).statusCode())
        assertEquals(403,call("PUT","${write(id)}/$first",owner,notice(pinned=true),csrf=false).statusCode())
        val pinned=call("PUT","${write(id)}/$first",owner,notice("info","안내로 변경","본문 변경",true))
        assertEquals(200,pinned.statusCode(),pinned.body())
        assertEquals(listOf<Any?>(first,"info","안내로 변경","본문 변경",true),
            node(pinned).let {listOf(it.path("id").asString(),it.path("category").asString(),it.path("title").asString(),it.path("body").asString(),it.path("pinned").asBoolean())})
        assertEquals(listOf(first,second),ids(call("GET",read(id))))
        assertEquals(owner.toString(),jdbc.queryForObject("SELECT author_id FROM work_notice WHERE id=?",String::class.java,first))
        assertEquals(200,call("PUT","${write(id)}/$first",admin,notice("info","안내로 변경","본문 변경",false)).statusCode())
        assertEquals(listOf(second,first),ids(call("GET",read(id))))

        // 삭제는 deleted_at만 기록하고 목록·수정·삭제에서 404로 빠진다. 타인은 403이다.
        assertEquals(403,call("DELETE","${write(id)}/$first",other).statusCode())
        assertEquals(204,call("DELETE","${write(id)}/$first",owner).statusCode())
        assertEquals(1,count("SELECT count(*) FROM work_notice WHERE id=? AND deleted_at IS NOT NULL",first))
        assertEquals(listOf(second),ids(call("GET",read(id))))
        assertEquals(404,call("PUT","${write(id)}/$first",owner,notice()).statusCode())
        assertEquals(404,call("DELETE","${write(id)}/$first",owner).statusCode())
        assertEquals(204,call("DELETE","${write(id)}/$second",admin).statusCode())
        assertEquals(emptyList<String>(),ids(call("GET",read(id))))

        // 다른 작품의 소식은 이 작품 경로로 고치거나 지울 수 없다(404).
        val elsewhere=work(other.toString())
        val foreign=created(call("POST",write(elsewhere),other,notice()))
        assertEquals(404,call("PUT","${write(id)}/$foreign",owner,notice()).statusCode())
        assertEquals(404,call("DELETE","${write(id)}/$foreign",owner).statusCode())
        assertEquals(0,count("SELECT count(*) FROM work_notice WHERE id=? AND deleted_at IS NOT NULL",foreign))
    }

    @Test fun `a private work hides its list but takes prepared notices and invalid input is rejected before anything else`() {
        val owner=member()
        val admin=member(operator=true)
        val draft=work(owner.toString(),publish=false)

        // 공개 목록은 공개 작품에서만 보인다(소유자에게도). 소유자와 운영자는 공개 전에 소식을 준비할 수 있다.
        assertEquals(404,call("GET",read(draft)).statusCode())
        assertEquals(404,call("GET",read(draft),owner).statusCode())
        created(call("POST",write(draft),owner,notice(title="준비 중")))
        created(call("POST",write(draft),admin,notice(title="운영 메모")))
        assertEquals(404,call("GET",read(draft)).statusCode())
        assertEquals(2,count("SELECT count(*) FROM work_notice WHERE work_id=?",draft))

        // 없는 작품은 404이지만 잘못된 입력은 404·403보다 먼저 422다.
        val missing=UUID.randomUUID().toString()
        val open=work(owner.toString())
        assertEquals(404,call("GET",read(missing)).statusCode())
        assertEquals(404,call("POST",write(missing),owner,notice()).statusCode())
        assertEquals(422,call("POST",write(missing),owner,notice(title="")).statusCode())
        assertEquals(422,call("POST",write(open),member(),notice(title="")).statusCode())

        val tooLongTitle="가".repeat(201)
        val tooLongBody="가".repeat(20_001)
        for(bad in listOf(
            """{"category":"info","title":"","body":"본문"}""","""{"category":"info","title":"   ","body":"본문"}""","""{"category":"info","title":"$nbsp","body":"본문"}""",
            """{"category":"info","title":"$tooLongTitle","body":"본문"}""","""{"category":"info","title":"제목\u0000","body":"본문"}""",
            """{"category":"info","title":"제목","body":""}""","""{"category":"info","title":"제목","body":"$nbsp"}""",
            """{"category":"info","title":"제목","body":"$tooLongBody"}""","""{"category":"info","title":"제목","body":"본문\u0000"}""",
            """{"category":"notice","title":"제목","body":"본문"}""","""{"category":"","title":"제목","body":"본문"}""","""{}""")) {
            assertEquals(422,call("POST",write(open),owner,bad).statusCode(),bad.take(60))
        }
        assertEquals(400,call("POST",write(open),owner,"{broken").statusCode())
        assertEquals(0,count("SELECT count(*) FROM work_notice WHERE work_id=?",open))

        // 잘못된 수정은 기존 값을 바꾸지 않는다.
        val kept=created(call("POST",write(open),owner,notice(title="원래 제목",body="원래 본문",pinned=true)))
        assertEquals(422,call("PUT","${write(open)}/$kept",owner,notice(title="")).statusCode())
        assertEquals(422,call("PUT","${write(open)}/$kept",owner,notice(category="notice")).statusCode())
        assertEquals(listOf<Any?>("원래 제목","원래 본문",true),
            jdbc.queryForObject("SELECT title,body,pinned FROM work_notice WHERE id=?",{rs,_ -> listOf<Any?>(rs.getString(1),rs.getString(2),rs.getBoolean(3))},kept))
    }
}
