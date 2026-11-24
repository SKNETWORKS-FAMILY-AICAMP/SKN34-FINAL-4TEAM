package ai.storyfork.content.feedbackreport

import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
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
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
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
 * 운영 서비스 전용 제보 열람(#750)을 실제 PostgreSQL과 서비스 토큰 체인으로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트와 공유하므로 이 테스트가 만든 작품(제목 태그)의 제보만 골라 비교하고, 순서는 제보 시각을 지금 이후로 직접 정해 결정적으로 만든다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "OPERATIONS_SERVICE_TOKEN=operations-test-service-token-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class InternalFeedbackReportIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var reports: FeedbackReportService
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    private val token="operations-test-service-token-at-least-32"
    private val wrongToken="wrong-service-token-wrong-service-token"
    private val owner="ops-report-owner"
    private val gone="ops-report-gone-reader"
    private val tag=UUID.randomUUID().toString().take(8)
    private val path="/internal/v1/feedback-reports"

    private fun call(query:String,serviceToken:String?=token):HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path$query")).header("Accept","application/json")
        if(serviceToken!=null) request.header("X-Operations-Service-Token",serviceToken)
        return client.send(request.GET().build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun read(query:String=""):JsonNode {
        val response=call(query)
        assertEquals(200,response.statusCode(),response.body())
        return json.readTree(response.body())
    }
    /** 이 테스트가 만든 작품의 제보만 응답 순서대로 고른다. */
    private fun mine(query:String):List<JsonNode> = read(query).path("items").filter { it.path("workTitle").asString().contains(tag) }
    private fun work(name:String):String {
        val id=works.create(owner,CreateWorkRequest("운영 제보 $tag $name","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        val draft=driver.edit(id,owner,DraftRequest("1화","본문",0))
        driver.publish(id,owner,PublishRequest(draft.revision,true,true,true,driver.history(id,owner).versions.last().id))
        return id
    }
    private fun report(workId:String,reporter:String,body:String,quote:String="",visibility:String?=null,daysAhead:Long):String {
        val id=reports.create(workId,1,reporter,CreateReportRequest("typo",body,quote,visibility)).id
        // 제보 시각을 지금보다 뒤로 정해 다른 테스트의 제보보다 새롭고 이 테스트 안의 순서가 결정되게 한다.
        jdbc.update("UPDATE feedback_report SET created_at=? WHERE id=?",Timestamp.from(Instant.now().plus(daysAhead,ChronoUnit.DAYS)),id)
        return id
    }

    @Test fun `the list needs the service token and answers the contract shape and 422 for a bad filter or window`() {
        for(wrong in listOf(null,wrongToken)) assertEquals(403,call("",wrong).statusCode())

        val body=read("?size=1")
        assertEquals(setOf("items","page","size","totalElements","totalPages"),body.propertyNames().toSet())
        assertEquals(listOf(0,1),listOf(body.path("page").asInt(),body.path("size").asInt()))
        for(bad in listOf("?status=held","?status=UNCHECKED","?page=-1","?page=x","?size=0","?size=101")) assertEquals(422,call(bad).statusCode(),bad)
    }

    @Test fun `every reader report of a live work is listed newest first with private text the quote and the withdrawal and the filters and pages follow`() {
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            (call.arguments[0] as Collection<*>).map { it as String }.filter { it!=gone }.associateWith { "$it-닉" }
        }
        val before=read("?size=1").path("totalElements").asLong()
        val live=work("live")
        val deleted=work("deleted")
        // 삭제될 작품의 제보가 가장 새롭고, 삭제되지 않은 작품의 제보는 first < second < third 순으로 새롭다.
        val first=report(live,"ops-reader-1","첫 제보",daysAhead=1)
        val second=report(live,"ops-reader-2","둘째 제보","인용 문장","public",daysAhead=2)
        val third=report(live,gone,"탈퇴자 제보",daysAhead=3)
        report(deleted,"ops-reader-1","삭제될 작품의 제보",daysAhead=4)
        reports.check(live,second,owner)
        reports.withdraw(live,first,"ops-reader-1")
        jdbc.update("UPDATE work SET deleted_at=now() WHERE id=?",deleted)

        val all=mine("?size=100")
        assertEquals(listOf(third,second,first),all.map { it.path("id").asString() })
        val byId=all.associateBy { it.path("id").asString() }
        // 비공개 제보의 원문도 읽고(운영자 열람), 철회 여부와 인용·공개 범위·상태·제보자 표시명(탈퇴한 회원 포함)이 담긴다.
        assertEquals(listOf("첫 제보",true,"private","unchecked","ops-reader-1-닉"),byId.getValue(first).let { listOf(it.path("body").asString(),it.path("withdrawn").asBoolean(),it.path("visibility").asString(),it.path("status").asString(),it.path("reporterName").asString()) })
        assertEquals(listOf("둘째 제보","인용 문장","public","checked",false),byId.getValue(second).let { listOf(it.path("body").asString(),it.path("quote").asString(),it.path("visibility").asString(),it.path("status").asString(),it.path("withdrawn").asBoolean()) })
        assertEquals(WITHDRAWN_MEMBER_NAME,byId.getValue(third).path("reporterName").asString())
        assertTrue(byId.getValue(first).path("quote").isNull)
        assertEquals(listOf("운영 제보 $tag live",live,1),byId.getValue(first).let { listOf(it.path("workTitle").asString(),it.path("workId").asString(),it.path("episodeNumber").asInt()) })
        // 상태 필터와 전체 수: 삭제된 작품의 제보는 세지 않는다.
        assertEquals(listOf(second),mine("?status=checked&size=100").map { it.path("id").asString() })
        assertEquals(listOf(third,first),mine("?status=unchecked&size=100").map { it.path("id").asString() })
        assertEquals(3L,read("?size=1").path("totalElements").asLong()-before)
        // 쪽: 한 개씩 읽으면 쪽 수가 전체 수와 같고 쪽마다 한 건이다.
        val firstPage=read("?size=1&page=0")
        assertEquals(1,firstPage.path("items").size())
        assertEquals(firstPage.path("totalElements").asInt(),firstPage.path("totalPages").asInt())
        assertEquals(third,read("?size=1&page=0").path("items")[0].path("id").asString())
        assertEquals(second,read("?size=1&page=1").path("items")[0].path("id").asString())
    }
}
