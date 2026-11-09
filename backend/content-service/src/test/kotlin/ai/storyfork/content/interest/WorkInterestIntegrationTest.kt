package ai.storyfork.content.interest

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
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import tools.jackson.databind.json.JsonMapper

/**
 * 관심 작품 HTTP 계약과 새 회차 알림 outbox를 실제 PostgreSQL로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * 브로커는 없으므로 발행기는 outbox 행을 보내지 못하고 두며, 이 테스트는 published_at이 아니라 행의 내용만 비교한다.
 * 회원은 테스트마다 새 UUID라 목록을 그대로 비교하고, outbox는 자신이 만든 작품 id로만 거른다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class WorkInterestIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var core: CoreAuthClient
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()

    private fun actor(): UUID=UUID.randomUUID().also { id -> `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id)) }
    private fun call(method: String,path: String,member: UUID?,csrf: Boolean=true): HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).method(method,HttpRequest.BodyPublishers.noBody()).header("Accept","application/json")
        if(csrf) request.header("Cookie",CsrfFixture.cookie).header("X-CSRF-TOKEN",CsrfFixture.token())
        if(member!=null) request.header("Authorization","Bearer $member")
        return client.send(request.build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun put(work: String,member: UUID?,csrf: Boolean=true)=call("PUT","/api/v1/works/$work/interest",member,csrf)
    private fun delete(work: String,member: UUID?,csrf: Boolean=true)=call("DELETE","/api/v1/works/$work/interest",member,csrf)
    private fun listed(member: UUID): List<String> {
        val response=call("GET","/api/v1/works/interests",member,csrf=false)
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body()).path("workIds").values().map {it.asString()}
    }
    private fun rows(work: String)=jdbc.queryForObject("SELECT count(*) FROM work_interest WHERE work_id=?",Int::class.java,work)!!
    private fun outbox(work: String)=jdbc.queryForList("SELECT recipient_id FROM content_event_outbox WHERE target_id=? AND target_type='work' AND type='content.episode.published'",String::class.java,work).filterNotNull().sorted()

    /** [owner]가 1화를 공개한 작품을 만든다. publish=false면 비공개 작품이다. */
    private fun work(owner: UUID,title: String,publish: Boolean=true): String {
        val id=works.create(owner.toString(),CreateWorkRequest(title,"소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        if(publish) {
            val draft=driver.edit(id,owner.toString(),DraftRequest("1화","본문",0))
            driver.publish(id,owner.toString(),PublishRequest(draft.revision,true,true,true,driver.history(id,owner.toString()).versions.last().id))
        }
        return id
    }
    /** 이미 만들어진 [number]화를 저장 버전으로 확정해 발행한다. 같은 번호를 다시 부르면 그 회차의 재발행이다. */
    private fun publishEpisode(id: String,owner: UUID,number: Int,body: String) {
        val saved=driver.writeEpisode(id,owner.toString(),number,DraftRequest("${number}화",body,driver.writing(id,owner.toString(),number).draft.revision),true)
        driver.publishEpisode(id,owner.toString(),number,PublishRequest(saved.draft.revision,true,versionId=saved.versions.last().id))
    }

    @Test fun `adding removing and listing are idempotent newest first and private to the member`() {
        val author=actor()
        val (first,second,third)=listOf("관심 첫째","관심 둘째","관심 셋째").map {work(author,it)}
        val reader=actor()
        val other=actor()

        assertEquals(emptyList<String>(),listed(reader))
        for(id in listOf(first,second,third)) assertEquals(204,put(id,reader).statusCode())
        assertEquals(204,put(first,reader).statusCode())
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM work_interest WHERE work_id=? AND member_id=?",Int::class.java,first,reader.toString()))
        assertEquals(listOf(third,second,first),listed(reader))

        assertEquals(204,delete(second,reader).statusCode())
        assertEquals(204,delete(second,reader).statusCode())
        assertEquals(listOf(third,first),listed(reader))

        assertEquals(emptyList<String>(),listed(other))
        assertEquals(204,put(second,other).statusCode())
        assertEquals(listOf(second),listed(other))
        assertEquals(listOf(third,first),listed(reader))
        assertEquals(204,delete(first,other).statusCode())
        assertEquals(listOf(second),listed(other))
        assertEquals(listOf(third,first),listed(reader))
    }

    @Test fun `private missing and anonymous calls are rejected`() {
        val author=actor()
        val open=work(author,"관심 공개")
        val draftOnly=work(author,"관심 비공개",publish=false)
        val reader=actor()

        for(id in listOf(draftOnly,UUID.randomUUID().toString())) {
            assertEquals(404,put(id,reader).statusCode(),id)
            assertEquals(404,delete(id,reader).statusCode(),id)
        }
        assertEquals(0,rows(draftOnly))
        assertEquals(401,put(open,null).statusCode())
        assertEquals(401,delete(open,null).statusCode())
        assertEquals(401,call("GET","/api/v1/works/interests",null,csrf=false).statusCode())
        assertEquals(403,put(open,reader,csrf=false).statusCode())
        assertEquals(403,delete(open,reader,csrf=false).statusCode())
        assertEquals(0,rows(open))
    }

    @Test fun `a work that is restricted drops out of the list and can not be added but keeps its row`() {
        val author=actor()
        val id=work(author,"관심 제한")
        val reader=actor()
        assertEquals(204,put(id,reader).statusCode())
        assertEquals(listOf(id),listed(reader))

        jdbc.update("UPDATE work SET restricted=true WHERE id=?",id)
        try {
            assertEquals(emptyList<String>(),listed(reader))
            assertEquals(404,put(id,actor()).statusCode())
            assertEquals(1,rows(id))
        } finally {
            jdbc.update("UPDATE work SET restricted=false WHERE id=?",id)
        }
        assertEquals(listOf(id),listed(reader))
    }

    @Test fun `a new episode queues one event per interested member except the author and a republish queues none`() {
        val author=actor()
        val id=work(author,"관심 알림")
        assertEquals(emptyList<String>(),outbox(id))
        val readers=List(2) {actor()}
        readers.forEach {assertEquals(204,put(id,it).statusCode())}
        assertEquals(204,put(id,author).statusCode())
        val expected=readers.map {it.toString()}.sorted()

        publishEpisode(id,author,2,"둘째 회차")
        assertEquals(expected,outbox(id))

        publishEpisode(id,author,2,"둘째 회차 수정본")
        assertEquals(expected,outbox(id))

        driver.createEpisode(id,author.toString(),ai.storyfork.content.fixture.CreateWorkRequest("3화"))
        publishEpisode(id,author,3,"셋째 회차")
        assertEquals((expected+expected).sorted(),outbox(id))
        assertEquals(4,jdbc.queryForObject("SELECT count(DISTINCT id) FROM content_event_outbox WHERE target_id=?",Int::class.java,id))
    }

    @Test fun `the tables keep one row per member and work and reject an unknown work`() {
        val author=actor()
        val id=work(author,"관심 제약")
        jdbc.update("INSERT INTO work_interest(work_id,member_id) VALUES (?,?)",id,"constraint-member")
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update("INSERT INTO work_interest(work_id,member_id) VALUES (?,?)",id,"constraint-member")}
        assertThrows(DataIntegrityViolationException::class.java) {jdbc.update("INSERT INTO work_interest(work_id,member_id) VALUES (?,?)",UUID.randomUUID().toString(),"constraint-member")}
        val event=UUID.randomUUID()
        jdbc.update("INSERT INTO content_event_outbox(id,type,recipient_id,target_type,target_id,occurred_at) VALUES (?,?,?,?,?,now())",event,"content.episode.published","constraint-member","work",id)
        assertThrows(DataIntegrityViolationException::class.java) {
            jdbc.update("INSERT INTO content_event_outbox(id,type,recipient_id,target_type,target_id,occurred_at) VALUES (?,?,?,?,?,now())",event,"content.episode.published","constraint-member","work",id)
        }
    }
}
