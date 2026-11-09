package ai.storyfork.content.work

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.JdbcTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** 운영 작품 목록 내부 API를 실제 PostgreSQL과 서비스 토큰 체인으로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "OPERATIONS_SERVICE_TOKEN=operations-test-service-token-at-least-32",
])
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class InternalWorkListPostgresTest {
    @LocalServerPort var port=0
    @Autowired @Qualifier("contentDataSource") lateinit var source:DataSource
    @Autowired lateinit var json:JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    private val token="operations-test-service-token-at-least-32"
    /** 공유 DB에서 이 테스트의 행만 골라내고 지우기 위한 제목 접두사다. */
    private val tag="ops-list-"+UUID.randomUUID()
    private val owner="ops-list-owner"

    private fun call(method:String,path:String,serviceToken:String?=token):HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
        if(serviceToken!=null) request.header("X-Operations-Service-Token",serviceToken)
        return client.send(request.method(method,HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun listed():List<JsonNode> {
        val response=call("GET","/internal/v1/works")
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body()).path("items").toList().filter {it.path("title").asString().startsWith(tag)}
    }
    /** work 한 건과 권리 진술·발행 이력(revision 0부터 [history] 순서)을 직접 넣는다. 서비스 흐름 없이 최신 이력 규칙만 겨냥한다. */
    private fun work(suffix:String,kind:String="original",type:String="original",rights:Boolean=false,history:List<String> = emptyList()):String {
        val id=UUID.randomUUID().toString()
        jdbc.update("INSERT INTO member(id) VALUES(?) ON CONFLICT DO NOTHING",owner)
        jdbc.update("INSERT INTO work(id,owner_id,title,description,origin_kind,creation_type,revision,author_name) VALUES(?,?,?,?,?,?,0,?)",
            id,owner,"$tag-$suffix","소개",kind,type,"작가-$suffix")
        if(rights) jdbc.update("INSERT INTO work_rights_declaration(id,work_id,member_id,notice_version,response,confirmed_at) VALUES(?,?,?,?,?,now())",
            UUID.randomUUID().toString(),id,owner,"test-rights-v1","confirmed")
        history.forEachIndexed {revision,visibility ->
            jdbc.update("INSERT INTO work_publication_history(id,work_id,revision_no,visibility) VALUES(?,?,?,?)",UUID.randomUUID().toString(),id,revision,visibility)
        }
        return id
    }
    /** JsonNode에 이미 있는 values()와 겹치지 않도록 다른 이름을 쓴다. */
    private fun JsonNode.summary()=listOf<Any>(path("originKind").asString(),path("creationType").asString(),path("rightsConfirmed").asBoolean(),path("visibility").asString(),path("restricted").asBoolean())

    @AfterEach fun cleanup() {
        val mine="SELECT id FROM work WHERE title LIKE ?"
        jdbc.update("DELETE FROM work_publication_history WHERE work_id IN ($mine)","$tag%")
        jdbc.update("DELETE FROM work_rights_declaration WHERE work_id IN ($mine)","$tag%")
        jdbc.update("DELETE FROM work WHERE title LIKE ?","$tag%")
    }

    @Test fun `list needs the service token and returns every work with kind rights latest visibility and restriction in title then id order`() {
        for(wrong in listOf(null,"wrong-service-token-wrong-service-token")) assertEquals(403,call("GET","/internal/v1/works",wrong).statusCode())

        // 제목 순서와 다르게 넣어 ORDER BY가 순서를 만들게 한다.
        val restrictedWork=work("e",rights=true,history=listOf("private","public"))
        val publicFork=work("d",kind="fork",rights=true,history=listOf("private","public"))
        val tie1=work("g");val tie2=work("g")
        val noRights=work("c",type="external_derivative")
        val unpublished=work("b",history=listOf("private","public","private"))
        val publicOriginal=work("a",rights=true,history=listOf("private","public"))
        assertEquals(403,call("PUT","/internal/v1/works/$restrictedWork/restriction",null).statusCode())
        assertEquals(true,json.readTree(call("PUT","/internal/v1/works/$restrictedWork/restriction").body()).path("restricted").asBoolean())

        val items=listed()
        // UUID는 소문자 16진수와 고정 위치 하이픈이라 DB collation과 Kotlin 정렬이 같다.
        assertEquals(listOf(publicOriginal,unpublished,noRights,publicFork,restrictedWork)+listOf(tie1,tie2).sorted(),items.map {it.path("workId").asString()})
        val byId=items.associateBy {it.path("workId").asString()}
        assertEquals(listOf<Any>("original","original",true,"public",false),byId.getValue(publicOriginal).summary())
        assertEquals(listOf<Any>("original","original",false,"private",false),byId.getValue(unpublished).summary(),"최신 이력이 private이면 앞선 public은 무시한다")
        assertEquals(listOf<Any>("original","external_derivative",false,"private",false),byId.getValue(noRights).summary(),"이력이 없으면 private")
        assertEquals(listOf<Any>("fork","original",true,"public",false),byId.getValue(publicFork).summary())
        assertEquals(listOf<Any>("original","original",true,"public",true),byId.getValue(restrictedWork).summary(),"제한은 공개 범위와 독립")
        val first=byId.getValue(publicOriginal)
        assertEquals(9,first.size(),"계약의 필드만 노출한다")
        assertEquals(listOf(owner,"$tag-a","작가-a"),listOf(first.path("ownerId").asString(),first.path("title").asString(),first.path("authorName").asString()))

        // 기존 단건·제한 해제 경로는 그대로 동작한다.
        assertEquals(403,call("GET","/internal/v1/works/$restrictedWork",null).statusCode())
        val one=json.readTree(call("GET","/internal/v1/works/$restrictedWork").body())
        assertEquals(listOf(restrictedWork,owner,"$tag-e",true),listOf(one.path("workId").asString(),one.path("ownerId").asString(),one.path("title").asString(),one.path("restricted").asBoolean()))
        assertEquals(false,json.readTree(call("DELETE","/internal/v1/works/$restrictedWork/restriction").body()).path("restricted").asBoolean())
        assertEquals(false,listed().single {it.path("workId").asString()==restrictedWork}.path("restricted").asBoolean())
        assertEquals(404,call("GET","/internal/v1/works/${UUID.randomUUID()}").statusCode())
    }
}
