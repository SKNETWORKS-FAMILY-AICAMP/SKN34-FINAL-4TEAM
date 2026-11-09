package ai.storyfork.content.reading

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
 * 독서 기록 HTTP 계약(이어 읽기 위치·읽은 회차 기록·조회·삭제)을 실제 PostgreSQL로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트의 작품과 공유하므로 각 테스트는 자신이 만든 작품·회원 id만 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class ReadingRecordIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    // 작품 응답의 작가명은 Core 닉네임 조회라 대역을 둔다(기본 대역은 빈 결과). 이 테스트는 작가명을 보지 않는다.
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()

    private fun actor(): UUID=UUID.randomUUID().also { id -> `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id)) }
    private fun send(method: String,path: String,member: UUID?,csrf: Boolean=true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).method(method,HttpRequest.BodyPublishers.noBody()).header("Accept","application/json")
        if(method!="GET" && csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun openEpisode(work: String,number: Int,member: UUID?,csrf: Boolean=true)=send("PUT","/api/v1/works/$work/reading/$number",member,csrf)
    private fun deleteRecord(work: String,member: UUID?,csrf: Boolean=true)=send("DELETE","/api/v1/works/$work/reading",member,csrf)
    private fun records(member: UUID): List<JsonNode> {
        val response=send("GET","/api/v1/works/reading",member)
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body()).path("records").toList()
    }
    private fun summary(member: UUID,vararg ids: String)=records(member).filter {it.path("workId").asText() in ids}
        .map {Triple(it.path("workId").asText(),it.path("lastEpisode").asInt(),it.path("readEpisodes").toList().map {n -> n.asInt()})}
    private fun rows(table: String,work: String)=jdbc.queryForObject("SELECT count(*) FROM $table WHERE work_id=?",Int::class.java,work)!!
    private fun publishNext(id: String,owner: String,title: String) {
        val draft=driver.edit(id,owner,DraftRequest(title,"본문",driver.read(id,owner).draft!!.revision))
        driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
    }
    /** 공개 작품 하나를 만든다. episodes=0이면 한 번도 발행하지 않은 비공개 작품이다. */
    private fun work(title: String,episodes: Int=2): String {
        val id=works.create("author",CreateWorkRequest(title,"소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        repeat(episodes) {publishNext(id,"author","${it+1}화")}
        return id
    }

    @Test fun `opening an episode moves the position to it and accumulates the read episodes`() {
        val target=work("독서 기록 공개")
        val reader=actor()

        assertEquals(emptyList<Triple<String,Int,List<Int>>>(),summary(reader,target))
        assertEquals(204,openEpisode(target,2,reader).statusCode())
        assertEquals(listOf(Triple(target,2,listOf(2))),summary(reader,target))
        assertEquals(204,openEpisode(target,1,reader).statusCode())
        assertEquals(listOf(Triple(target,1,listOf(1,2))),summary(reader,target))
        assertEquals(204,openEpisode(target,1,reader).statusCode())
        assertEquals(listOf(Triple(target,1,listOf(1,2))),summary(reader,target))
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM reading_episode WHERE work_id=? AND member_id=?",Int::class.java,target,reader.toString()))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM reading_record WHERE work_id=? AND member_id=?",Int::class.java,target,reader.toString()))
        assertTrue(Instant.parse(records(reader).first {it.path("workId").asText()==target}.path("updatedAt").asText())<=Instant.now())
    }

    @Test fun `only public published episodes are recorded and only for logged in members`() {
        val target=work("독서 기록 대상")
        val draftOnly=work("독서 기록 비공개",episodes=0)
        val reader=actor()

        assertEquals(404,openEpisode(target,3,reader).statusCode())
        assertEquals(404,openEpisode(target,0,reader).statusCode())
        assertEquals(404,openEpisode(draftOnly,1,reader).statusCode())
        assertEquals(404,openEpisode(UUID.randomUUID().toString(),1,reader).statusCode())
        assertEquals(401,openEpisode(target,1,null).statusCode())
        assertEquals(403,openEpisode(target,1,reader,csrf=false).statusCode())
        assertEquals(0,rows("reading_record",target)+rows("reading_episode",target)+rows("reading_record",draftOnly)+rows("reading_episode",draftOnly))
        assertEquals(401,send("GET","/api/v1/works/reading",null).statusCode())
    }

    @Test fun `records are private to the member newest first and hide works that are no longer public`() {
        val first=work("독서 기록 첫째")
        val second=work("독서 기록 둘째")
        val reader=actor()
        val other=actor()

        assertEquals(204,openEpisode(first,1,reader).statusCode())
        assertEquals(204,openEpisode(second,2,reader).statusCode())
        assertEquals(listOf(Triple(second,2,listOf(2)),Triple(first,1,listOf(1))),summary(reader,first,second))
        assertEquals(emptyList<Triple<String,Int,List<Int>>>(),summary(other,first,second))

        assertEquals(204,openEpisode(first,2,reader).statusCode())
        assertEquals(listOf(Triple(first,2,listOf(1,2)),Triple(second,2,listOf(2))),summary(reader,first,second))

        jdbc.update("UPDATE work SET restricted=true WHERE id=?",second)
        assertEquals(listOf(Triple(first,2,listOf(1,2))),summary(reader,first,second))
        assertEquals(1,rows("reading_record",second))
        jdbc.update("UPDATE work SET restricted=false WHERE id=?",second)
        assertEquals(2,summary(reader,first,second).size)
    }

    @Test fun `deleting removes only that work records and repeats safely`() {
        val first=work("독서 기록 삭제 첫째")
        val second=work("독서 기록 삭제 둘째")
        val reader=actor()
        val other=actor()
        listOf(first,second).forEach {assertEquals(204,openEpisode(it,1,reader).statusCode());assertEquals(204,openEpisode(it,2,reader).statusCode())}
        assertEquals(204,openEpisode(first,1,other).statusCode())

        assertEquals(401,deleteRecord(first,null).statusCode())
        assertEquals(403,deleteRecord(first,reader,csrf=false).statusCode())
        assertEquals(2,summary(reader,first,second).size)

        assertEquals(204,deleteRecord(first,reader).statusCode())
        assertEquals(listOf(Triple(second,2,listOf(1,2))),summary(reader,first,second))
        assertEquals(listOf(Triple(first,1,listOf(1))),summary(other,first,second))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM reading_episode WHERE work_id=? AND member_id=?",Int::class.java,first,reader.toString()))
        assertEquals(204,deleteRecord(first,reader).statusCode())
        assertEquals(204,deleteRecord(UUID.randomUUID().toString(),reader).statusCode())
        assertEquals(1,summary(reader,first,second).size)
    }

    @Test fun `episodes a public Fork inherited from its original are recorded for the Fork`() {
        val original=work("독서 기록 원작",episodes=1)
        val owner=actor()
        val fork=driver.fork(original,owner.toString(),ForkRequest(1,"독서 기록 분기")).id
        publishNext(fork,owner.toString(),"분기 2화")
        val reader=actor()

        assertEquals(204,openEpisode(fork,1,reader).statusCode())
        assertEquals(204,openEpisode(fork,2,reader).statusCode())
        assertEquals(204,openEpisode(fork,1,reader).statusCode())
        assertEquals(listOf(Triple(fork,1,listOf(1,2))),summary(reader,fork))
        assertEquals(404,openEpisode(fork,3,reader).statusCode())
    }
}
