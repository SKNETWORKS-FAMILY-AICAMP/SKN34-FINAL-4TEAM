package ai.storyfork.content.like

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
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
 * 작품 좋아요 HTTP 계약(누르기·취소·수·내 좋아요 여부)을 실제 PostgreSQL로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트의 작품과 공유하므로 각 테스트는 자신이 만든 작품 id만 골라 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class WorkLikeIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()

    private fun actor(): UUID=UUID.randomUUID().also { id -> `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id)) }
    private fun send(request: HttpRequest.Builder): HttpResponse<String> = client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    private fun get(path: String,member: UUID?=null): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
        if(member!=null) request.header("Authorization","Bearer $member")
        return send(request)
    }
    private fun press(work: String,member: UUID?,method: String="PUT",csrf: Boolean=true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port/api/v1/works/$work/like")).method(method,HttpRequest.BodyPublishers.noBody())
        if(csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return send(request)
    }
    private fun like(work: String,member: UUID)=press(work,member,"PUT")
    private fun unlike(work: String,member: UUID)=press(work,member,"DELETE")
    private fun body(response: HttpResponse<String>): JsonNode {
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body())
    }
    private fun result(response: HttpResponse<String>)=body(response).let {it.path("likes").asLong() to it.path("liked").asBoolean()}
    private fun count(work: String)=jdbc.queryForObject("SELECT count(*) FROM work_like WHERE work_id=?",Int::class.java,work)!!
    private fun work(title: String,publish: Boolean=true,owner: String="author"): String {
        val id=works.create(owner,CreateWorkRequest(title,"소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        if(publish) {
            val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
            driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        }
        return id
    }
    private fun listed(path: String,id: String)=json.readTree(get(path).body()).toList().first {it.path("id").asText()==id}

    @Test fun `like and unlike are idempotent per member and the count is the number of distinct members`() {
        val id=work("좋아요 작품")
        val first=actor()
        val second=actor()

        assertEquals(1L to true,result(like(id,first)))
        assertEquals(1L to true,result(like(id,first)))
        assertEquals(2L to true,result(like(id,second)))
        assertEquals(1L to false,result(unlike(id,first)))
        assertEquals(1L to false,result(unlike(id,first)))
        assertEquals(1,count(id))
        assertEquals(0L to false,result(unlike(id,second)))
        assertEquals(0,count(id))
    }

    @Test fun `a member may like their own public work`() {
        val owner=actor()
        val id=work("내 작품 좋아요",owner=owner.toString())

        assertEquals(1L to true,result(like(id,owner)))
        assertEquals(1,count(id))
    }

    @Test fun `private restricted or unknown works are 404 while anonymous is 401 and a missing csrf token is 403`() {
        val draftOnly=work("비공개 좋아요",publish=false)
        val restricted=work("제한 좋아요")
        jdbc.update("UPDATE work SET restricted=true WHERE id=?",restricted)
        val open=work("공개 좋아요")
        val reader=actor()

        for(target in listOf(draftOnly,restricted,UUID.randomUUID().toString())) {
            assertEquals(404,like(target,reader).statusCode(),target)
            assertEquals(404,unlike(target,reader).statusCode(),target)
        }
        assertEquals(401,press(open,null).statusCode())
        assertEquals(401,press(open,null,"DELETE").statusCode())
        assertEquals(403,press(open,reader,csrf=false).statusCode())
        assertEquals(403,press(open,reader,"DELETE",csrf=false).statusCode())
        assertEquals(0,count(draftOnly)+count(restricted)+count(open))
    }

    @Test fun `public list ranking and detail carry likes and the detail tells the signed in member whether they liked`() {
        val id=work("수 표시 작품")
        val quiet=work("조용한 작품")
        val fan=actor()
        val other=actor()
        // 공유 DB의 다른 작품 조회 수보다 확실히 많아야 최대 10개 랭킹에 들어간다.
        repeat(30) {jdbc.update("INSERT INTO work_view(work_id,episode_number,member_id,view_date,viewed_at) VALUES (?,1,?,current_date,now())",id,"seed-$it")}
        like(id,fan)
        like(id,other)

        assertEquals(2L,listed("/api/v1/public/works",id).path("likes").asLong())
        assertEquals(0L,listed("/api/v1/public/works",quiet).path("likes").asLong())
        assertEquals(2L,listed("/api/v1/public/works/ranking?kind=top",id).path("likes").asLong())
        assertEquals(2L,listed("/api/v1/public/works?sort=view",id).path("likes").asLong())

        val anonymous=body(get("/api/v1/public/works/$id"))
        assertEquals(2L,anonymous.path("likes").asLong())
        assertFalse(anonymous.path("liked").asBoolean())
        assertTrue(body(get("/api/v1/public/works/$id",fan)).path("liked").asBoolean())
        assertFalse(body(get("/api/v1/public/works/$id",actor())).path("liked").asBoolean())
        assertEquals(404,get("/api/v1/public/works/${UUID.randomUUID()}",fan).statusCode())
    }

    @Test fun `owner list and detail carry the like count`() {
        val owner=actor()
        val id=work("소유자 수 표시",owner=owner.toString())
        like(id,actor())

        assertEquals(1L,body(get("/api/v1/works/$id",owner)).path("likes").asLong())
        val mine=json.readTree(get("/api/v1/works",owner).body()).toList().first {it.path("id").asText()==id}
        assertEquals(1L,mine.path("likes").asLong())
    }
}
