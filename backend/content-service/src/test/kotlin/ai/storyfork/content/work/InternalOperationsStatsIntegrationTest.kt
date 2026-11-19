package ai.storyfork.content.work

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.editsuggestion.service.EditSuggestionService
import ai.storyfork.content.editsuggestion.service.dto.CreateSuggestionRequest
import ai.storyfork.content.feedbackreport.service.FeedbackReportService
import ai.storyfork.content.feedbackreport.service.dto.CreateReportRequest
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.fixture.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
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
 * 운영 통계 내부 API(DEC-55)를 실제 PostgreSQL과 서비스 토큰 체인으로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트와 공유하므로 대기 수는 만들기 전후의 증가분으로, 기간 안 결정은 다른 테스트가 쓰지 않는 2032년 구간으로 비교한다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "OPERATIONS_SERVICE_TOKEN=operations-test-service-token-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class InternalOperationsStatsIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var reports: FeedbackReportService
    @Autowired lateinit var suggestions: EditSuggestionService
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    private val token="operations-test-service-token-at-least-32"
    private val wrongToken="wrong-service-token-wrong-service-token"
    private val owner="ops-stats-owner"
    private val tag=UUID.randomUUID().toString().take(8)
    private val stats="/internal/v1/operations/stats"
    private val window="?from=2032-01-01T00:00:00Z&to=2032-12-31T00:00:00Z"

    private fun call(path:String,serviceToken:String?=token):HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
        if(serviceToken!=null) request.header("X-Operations-Service-Token",serviceToken)
        return client.send(request.GET().build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun read(path:String=stats):JsonNode {
        val response=call(path)
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body())
    }
    /** 제보·수정 제안을 받을 수 있는 공개 작품(1회차 발행, 본문 '본문')이다. */
    private fun work(name:String):String {
        val id=works.create(owner,CreateWorkRequest("운영 통계 $tag $name","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
        driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        return id
    }
    private fun report(workId:String):String=reports.create(workId,1,"ops-reader",CreateReportRequest("typo","오탈자가 있어요","",null)).id
    private fun suggestion(workId:String):String=suggestions.create(workId,1,"ops-reader",CreateSuggestionRequest("본문","고친 본문 ${UUID.randomUUID()}")).id
    /** 서비스 흐름 대신 상태와 판단 시각을 직접 정한다(기간 비교를 결정적으로 만든다). */
    private fun settle(id:String,status:String,at:String) {
        jdbc.update("UPDATE edit_suggestion SET status=?,decided_at=? WHERE id=?",status,Timestamp.from(Instant.parse(at)),id)
    }
    /** [createdAt]에 생성된 AI 제안 한 건이다. [acceptedAt]이 있으면 그 시각의 채택(accept) 결정도 남긴다. 결정 행은 바꿀 수 없으니 처음부터 시각을 정해 넣는다. */
    private fun proposal(workId:String,createdAt:String,acceptedAt:String?=null) {
        val job=UUID.randomUUID().toString()
        val proposal=UUID.randomUUID().toString()
        jdbc.update("INSERT INTO ai_job(id,requester_id,work_id,kind,status) VALUES (?,?,?,?,?)",job,owner,workId,"continuation","completed")
        jdbc.update("INSERT INTO ai_proposal(id,job_id,kind,content,created_at) VALUES (?,?,?,?,?)",proposal,job,"continuation","제안 본문",Timestamp.from(Instant.parse(createdAt)))
        if(acceptedAt!=null) jdbc.update("INSERT INTO proposal_decision(id,proposal_id,sequence,decision,approved_content,decided_at) VALUES (?,?,?,?,?,?)",
            UUID.randomUUID().toString(),proposal,1,"accept","제안 본문",Timestamp.from(Instant.parse(acceptedAt)))
    }

    @Test fun `stats need the service token return the contract shape and reject a bad window with 422`() {
        for(wrong in listOf(null,wrongToken)) assertEquals(403,call(stats,wrong).statusCode())

        val body=read()
        assertEquals(setOf("pendingFeedbackReports","pendingEditSuggestions","proposalDecisions","editSuggestions"),body.propertyNames().toSet())
        assertEquals(setOf("adopted","total"),body.path("proposalDecisions").propertyNames().toSet())
        assertEquals(setOf("approved","decided"),body.path("editSuggestions").propertyNames().toSet())
        for(bad in listOf("?from=yesterday","?from=2026-11-19","?to=x","?from=2032-02-01T00:00:00Z&to=2032-01-01T00:00:00Z")) assertEquals(422,call(stats+bad).statusCode(),bad)
    }

    @Test fun `pending counts take unhandled items of live works and decision counts follow the window`() {
        val before=read()
        val open=work("open")
        val gone=work("gone")

        // 제보: 확인 전 둘(삭제될 작품의 하나는 뺀다)과 이미 확인한 하나.
        report(open); report(open)
        reports.check(open,report(open),owner)
        report(gone)
        // 수정 제안: 검토 대기 둘, 보류 하나, 삭제될 작품의 검토 대기 하나.
        suggestion(open); suggestion(open)
        settle(suggestion(open),"held","2032-05-01T00:00:00Z")
        suggestion(gone)
        // 기간(2032년) 안 판단: 승인 둘(하나는 삭제된 작품), 거절 하나, 기간 밖 승인 하나. 보류는 판단이 아니다.
        settle(suggestion(open),"approved","2032-02-01T00:00:00Z")
        settle(suggestion(gone),"approved","2032-03-01T00:00:00Z")
        settle(suggestion(open),"rejected","2032-04-01T00:00:00Z")
        settle(suggestion(open),"approved","2033-01-01T00:00:00Z")
        // AI 제안: 기간 안에 생성돼 채택된 둘, 기간 안에 생성됐지만 채택 안 된 둘(total에만 든다), 기간 앞에 생성돼 기간 안에 채택된 하나(adopted에만 든다), 기간 밖 하나.
        proposal(open,"2032-02-01T00:00:00Z","2032-02-02T00:00:00Z")
        proposal(open,"2032-06-01T00:00:00Z","2032-06-02T00:00:00Z")
        proposal(open,"2032-07-01T00:00:00Z")
        proposal(open,"2032-08-01T00:00:00Z")
        proposal(open,"2031-12-30T00:00:00Z","2032-01-02T00:00:00Z")
        proposal(open,"2033-01-01T00:00:00Z","2033-01-02T00:00:00Z")
        jdbc.update("UPDATE work SET deleted_at=now() WHERE id=?",gone)

        val after=read()
        assertEquals(2L,after.path("pendingFeedbackReports").asLong()-before.path("pendingFeedbackReports").asLong())
        assertEquals(2L,after.path("pendingEditSuggestions").asLong()-before.path("pendingEditSuggestions").asLong())
        val inWindow=read(stats+window)
        assertEquals(listOf(2L,3L),listOf(inWindow.path("editSuggestions").path("approved").asLong(),inWindow.path("editSuggestions").path("decided").asLong()))
        assertEquals(listOf(3L,4L),listOf(inWindow.path("proposalDecisions").path("adopted").asLong(),inWindow.path("proposalDecisions").path("total").asLong()))
        // 기간을 생략하면 최근 7일이라 2032년 결정은 들어오지 않는다.
        val recent=read()
        assertEquals(before.path("editSuggestions").path("approved").asLong(),recent.path("editSuggestions").path("approved").asLong())
        assertEquals(before.path("proposalDecisions").path("total").asLong(),recent.path("proposalDecisions").path("total").asLong())
    }
}
