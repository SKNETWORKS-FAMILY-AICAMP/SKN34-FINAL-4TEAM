package ai.storyfork.content.regression

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.SettingPayload
import ai.storyfork.content.world.service.dto.SettingRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.`when`
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.jdbc.core.JdbcTemplate
import javax.sql.DataSource
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.json.JsonMapper

/** Content HTTP/DB 경계. 실제 Core 로그인→확인은 CI 시스템 시나리오에서 별도 실행한다. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class AuthContentIntegrationTest {
    // 작가명·작성자명은 Core 닉네임이다. 이 테스트는 이름을 보지 않으므로 Core 조회는 빈 결과를 돌려주는 대역이다.
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @LocalServerPort var port=0
    @MockitoBean lateinit var core:CoreAuthClient
    @Autowired @Qualifier("contentDataSource") lateinit var source:DataSource
    @Autowired lateinit var json:JsonMapper
    @Autowired lateinit var works:WorkService
    @Autowired lateinit var versions:EpisodeVersionService
    @Autowired lateinit var publication:PublicationService
    @Autowired lateinit var worlds:WorldService
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    private fun request(path:String)=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
    private fun send(request:HttpRequest.Builder)=client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    private fun mutation(path:String,body:String)=request(path).header("Cookie",CsrfFixture.cookie)
        .header("X-CSRF-TOKEN",CsrfFixture.token()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body))
    private fun actor():UUID=UUID.randomUUID().also { id -> `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id)) }

    @Test fun `Core verified UUID owns private content and another member receives 404`() {
        val user=actor()
        val created=send(mutation("/api/v1/works","""{"title":"verified ownership"}""")
            .header("Authorization","Bearer $user").header("X-User-Id","forged-owner"))
        assertEquals(201,created.statusCode(),created.body())
        val id=json.readTree(created.body()).path("id").asText()
        assertEquals(user.toString(),jdbc.queryForObject("SELECT owner_id FROM work WHERE id=?",String::class.java,id))
        assertEquals(200,send(request("/api/v1/works/$id").header("Authorization","Bearer $user")).statusCode())
        assertEquals(404,send(request("/api/v1/works/$id").header("Authorization","Bearer ${actor()}")).statusCode())
        assertEquals(404,send(request("/api/v1/public/works/$id")).statusCode())
        val versions=jdbc.queryForList("SELECT version FROM content_schema_history WHERE success AND type <> 'BASELINE'",String::class.java)
        assertTrue(versions.containsAll((1..9).map(Int::toString)))
        assertTrue(source.connection.use { c -> c.metaData.getTables(null,"public","auth_member",null).use { !it.next() } },"Content does not initialize Auth")
    }

    @Test fun `public wiki HTTP requires a published episode and never trusts ownership headers`() {
        val owner=actor().toString()
        val work=works.create(owner,CreateWorkRequest("public wiki boundary"))
        val path="/api/v1/public/works/${work.id}/world"
        assertEquals(404,send(request("$path?episode=1").header("X-User-Id",owner)).statusCode())
        for((name,visibility,at) in listOf(Triple("visible","public",1),Triple("private","private",1),Triple("future","public",2))) {
            val world=worlds.read(work.id,owner)
            val saved=worlds.saveDraft(work.id,"new",owner,SettingRequest(world.revision,
                SettingPayload(name=name,content="${name}-body",visibility=visibility,fromEpisode=at,knownBy=listOf("*")),world.sourceToken))
            worlds.commit(work.id,saved.draft!!.id,owner,saved.revision)
        }
        val saved=versions.saveCurrent(work.id,owner,DraftRequest("1화","published body",work.revision))
        publication.publishCurrent(work.id,owner,PublishRequest(saved.draft.revision,true,versionId=saved.version.id))
        val response=send(request("$path?episode=1"))
        assertEquals(200,response.statusCode(),response.body())
        val tree=json.readTree(response.body())
        assertEquals(work.id,tree.path("workId").asText())
        assertEquals(1,tree.path("episode").asInt())
        // Jackson 3.1의 JsonNode.map(Function)은 노드 자신에 적용돼 배열을 순회하지 않으므로 List로 바꾼 뒤 map한다.
        assertEquals(listOf("visible"),tree.path("documents").toList().map {it.path("name").asText()})
        assertFalse(response.body().contains("private-body"));assertFalse(response.body().contains("future-body"))
        for(query in listOf("","?episode=bad")) assertEquals(400,send(request(path+query)).statusCode())
        for(episode in listOf(0,-1,2)) assertEquals(404,send(request("$path?episode=$episode").header("X-User-Id",owner)).statusCode())
        assertEquals(404,send(request("/api/v1/public/works/${UUID.randomUUID()}/world?episode=1")).statusCode())
        assertEquals(401,send(request("/api/v1/works/${work.id}/world").header("X-User-Id",owner)).statusCode())
    }

    @Test fun `author name is the owner Core nickname on public and owner reads and author search matches it`() {
        val owner=actor()
        val work=works.create(owner.toString(),CreateWorkRequest("작가명 조회 검증"))
        val saved=versions.saveCurrent(work.id,owner.toString(),DraftRequest("1화","published body",work.revision))
        publication.publishCurrent(work.id,owner.toString(),PublishRequest(saved.draft.revision,true,versionId=saved.version.id))
        // Core 대역: 이 소유자만 알고 나머지는 Core에 없는(탈퇴한) 회원이다.
        val nickname="작가-${owner.toString().take(8)}"
        `when`(nicknames.nicknames(org.mockito.ArgumentMatchers.anyCollection<String>())).thenAnswer {call ->
            (call.arguments[0] as Collection<*>).map {it as String}.filter {it==owner.toString()}.associateWith {nickname}
        }
        fun author(response:HttpResponse<String>):String {
            assertEquals(200,response.statusCode(),response.body())
            return json.readTree(response.body()).path("authorName").asString()
        }
        assertEquals(nickname,author(send(request("/api/v1/public/works/${work.id}"))))
        assertEquals(nickname,author(send(request("/api/v1/works/${work.id}").header("Authorization","Bearer $owner"))))
        for(path in listOf("/api/v1/public/works","/api/v1/works")) {
            val response=send(request(path+if(path.startsWith("/api/v1/public")) "?f=author&q="+java.net.URLEncoder.encode(nickname,Charsets.UTF_8) else "").header("Authorization","Bearer $owner"))
            assertEquals(200,response.statusCode(),response.body())
            val mine=json.readTree(response.body()).toList().filter {it.path("id").asString()==work.id}
            assertEquals(listOf(nickname),mine.map {it.path("authorName").asString()},path)
        }
        // Core에 없는 소유자는 임의 이름이 아니라 탈퇴한 회원으로 보인다.
        val unknown=works.create("legacy-owner",CreateWorkRequest("Core에 없는 소유자"))
        assertEquals("탈퇴한 회원",works.read(unknown.id,"legacy-owner").authorName)
    }

    @Test fun `only public GET is anonymous and private writes require csrf and allowed origin`() {
        assertEquals(200,send(request("/api/v1/public/works")).statusCode())
        assertEquals(401,send(request("/api/v1/works").header("X-User-Id","forged-owner")).statusCode())
        assertEquals(401,send(mutation("/api/v1/works","""{"title":"anonymous"}""")).statusCode())
        assertEquals(401,send(mutation("/api/v1/public/works","{}")).statusCode())
        val user=actor()
        assertEquals(403,send(request("/api/v1/works").header("Authorization","Bearer $user").header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{}"))).statusCode())
        assertEquals(403,send(mutation("/api/v1/works","""{"title":"foreign origin"}""").header("Authorization","Bearer $user").header("Origin","https://evil.example")).statusCode())
        for(path in listOf("/api/v1/not-implemented","/error")) assertEquals(403,send(request(path).header("Authorization","Bearer $user")).statusCode())
        assertEquals(403,send(mutation("/api/v1/public/works","{}").header("Authorization","Bearer $user")).statusCode())
        val invalid=send(mutation("/api/v1/works","""{"title":""}""").header("Authorization","Bearer $user"))
        assertEquals(422,invalid.statusCode());assertFalse(invalid.body().contains("rejected value"))
    }
}
