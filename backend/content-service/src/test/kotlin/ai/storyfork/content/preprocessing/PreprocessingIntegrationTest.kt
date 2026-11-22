package ai.storyfork.content.preprocessing

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.fixture.ContentTestConfig
import ai.storyfork.content.fixture.ContentTestDriver
import ai.storyfork.content.fixture.DraftRequest
import ai.storyfork.content.preprocessing.client.PreprocessingAiClient
import ai.storyfork.content.preprocessing.client.dto.PreprocessingAiRequest
import ai.storyfork.content.preprocessing.service.PreprocessingService
import ai.storyfork.content.preprocessing.service.dto.PreprocessingProgressRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.world.service.ManuscriptBuildService
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.times
import org.mockito.Mockito.verify
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
 * 전처리 작업 기록(#343)을 실제 PostgreSQL(integer[] 칼럼·유일 인덱스·행 잠금)과 두 서비스 토큰 체인으로 검증한다. TEST_CONTENT_DATABASE_URL이 있을 때만 실행한다.
 * DB는 다른 테스트와 공유하므로 각 테스트는 자신이 만든 작품의 작업만 비교하고, AI 서비스 접수 호출은 [ai] 대역이다.
 */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties=[
    "app.manuscript-build.enabled=true",
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "OPERATIONS_SERVICE_TOKEN=operations-test-service-token-at-least-32",
    "INTERNAL_TOKEN=internal-test-service-token-at-least-32",
])
@Import(ContentTestConfig::class)
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class PreprocessingIntegrationTest {
    @LocalServerPort var port=0
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @MockitoBean lateinit var ai: PreprocessingAiClient
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var driver: ContentTestDriver
    @Autowired lateinit var build: ManuscriptBuildService
    @Autowired lateinit var service: PreprocessingService
    @Autowired @Qualifier("contentDataSource") lateinit var source: DataSource
    @Autowired lateinit var json: JsonMapper
    private val jdbc get()=JdbcTemplate(source)
    private val client=HttpClient.newHttpClient()
    private val operations=mapOf("X-Operations-Service-Token" to "operations-test-service-token-at-least-32")
    private val internal=mapOf("X-Internal-Token" to "internal-test-service-token-at-least-32")
    private val tag=UUID.randomUUID().toString().take(8)

    /** 저장 회차(1화) 하나를 가진 작품이다. saveCurrent가 저장 버전(is_saved)을 남긴다. */
    private fun work(owner:String):String {
        val id=works.create(owner,CreateWorkRequest("전처리 ${tag}","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        driver.edit(id,owner,DraftRequest("1화","본문",0))
        return id
    }
    private fun call(method:String,path:String,headers:Map<String,String>,body:String?=null):HttpResponse<String> {
        val request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept","application/json")
        headers.forEach { (name,value) -> request.header(name,value) }
        if(body!=null) request.header("Content-Type","application/json")
        val publisher=if(body==null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)
        return client.send(request.method(method,publisher).build(),HttpResponse.BodyHandlers.ofString())
    }
    private fun node(response:HttpResponse<String>):JsonNode=json.readTree(response.body())
    /** AI의 진행 보고 본문이다. [failed]가 있으면 1화를 실패 회차로 싣는다. */
    private fun report(stage:String,done:Int,failed:String?=null):String=json.writeValueAsString(buildMap<String,Any> {
        put("stage",stage); put("done",done); put("total",1); put("failedEpisodes",if(failed==null) emptyList<Int>() else listOf(1))
        if(failed!=null) put("failed",failed)
    })
    private fun failure(block:()->Unit)=assertThrows(ContentFailure::class.java,block)

    @Test fun `접수·진행·실패·재실행이 integer 배열 칼럼과 유일 인덱스까지 이어진다`() {
        val owner=UUID.randomUUID().toString()
        val id=work(owner)
        assertEquals(listOf(1),jdbc.queryForList("SELECT sequence FROM episode WHERE work_id=?",Int::class.java,id).filterNotNull().sorted())

        val started=service.start(id,owner)
        assertEquals(listOf<Any?>("queued",1,0,null),listOf(started.status,started.total,started.done,started.startedAt))
        assertEquals(started.id,started.build?.requestKey,"요청 key 없이 접수하면 key는 작업 id다")
        verify(ai).accept(PreprocessingAiRequest(started.id,id,listOf(1)))
        assertEquals("{}",jdbc.queryForObject("SELECT failed_episodes::text FROM preprocessing_job WHERE id=?",String::class.java,started.id))
        assertEquals(409,failure { service.start(id,owner) }.status,"진행 중인 작업이 있으면 새로 접수하지 않는다")

        assertEquals(409,failure { service.progress(started.id,PreprocessingProgressRequest("extracting",0,1,emptyList())) }.status)
        val jobId=UUID.fromString(started.id)
        val token=build.claim(jobId,id).getValue("token") as UUID
        assertEquals("running",service.latest(id,owner).status)
        build.failed(jobId,token,"EXTRACTION_FAILED",listOf(1))
        val failed=service.latest(id,owner)
        assertEquals(listOf<Any?>("failed",listOf(1),"EXTRACTION_FAILED"),listOf(failed.status,failed.failedEpisodes,failed.error))
        assertEquals("{1}",jdbc.queryForObject("SELECT failed_episodes::text FROM preprocessing_job WHERE id=?",String::class.java,started.id))
        assertEquals(409,failure { service.progress(started.id,PreprocessingProgressRequest("extracting",1,1,emptyList())) }.status,"끝난 작업은 진행을 받지 않는다")
        assertEquals(started.id,service.latest(id,owner).id)
        assertEquals(404,failure { service.latest(id,"someone-else") }.status)

        val retried=service.retry(started.id)
        assertEquals(listOf<Any?>("queued",null,null),listOf(retried.status,retried.error,retried.finishedAt))
        verify(ai,times(2)).accept(PreprocessingAiRequest(started.id,id,listOf(1)))
        assertEquals(409,failure { service.retry(started.id) }.status,"대기 중인 작업은 다시 실행하지 않는다")
        assertEquals(listOf("queued"),service.list(null,"0","100").items.filter { it.workId==id }.map { it.status })
    }

    @Test fun `작품당 진행 중·완료 작업은 하나뿐이고 실패한 작업 뒤에는 새로 접수한다`() {
        val owner=UUID.randomUUID().toString()
        val id=work(owner)
        val first=service.start(id,owner)
        val jobId=UUID.fromString(first.id)
        build.failed(jobId,build.claim(jobId,id).getValue("token") as UUID,"EXTRACTION_FAILED",listOf(1))
        val second=service.start(id,owner)
        assertNotEquals(first.id,second.id)
        assertEquals(second.id,service.latest(id,owner).id)
        assertEquals(409,failure { service.retry(first.id) }.status,"더 새로운 작업이 있으면 옛 작업은 다시 실행하지 않는다")
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM preprocessing_job WHERE work_id=? AND status IN ('queued','running','loading','completed')",Int::class.java,id))
    }

    @Test fun `저장 회차가 없는 작품은 422이고 AI에 접수하지 않는다`() {
        val owner=UUID.randomUUID().toString()
        val id=works.create(owner,CreateWorkRequest("전처리 빈 ${tag}","소개","ORIGINAL",listOf("판타지"),emptyList(),true)).id
        assertEquals(422,failure { service.start(id,owner) }.status)
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM preprocessing_job WHERE work_id=?",Int::class.java,id))
    }

    @Test fun `진행 보고는 AI 토큰만 목록·재실행은 운영 토큰만 받는다`() {
        val owner=UUID.randomUUID().toString()
        val id=work(owner)
        // 기존 V41 작업만 AI의 progress 보고를 받는다.
        val job=UUID.randomUUID().toString()
        jdbc.update("INSERT INTO preprocessing_job(id,work_id,member_id,status,total,created_at) VALUES (?,?,?,'queued',1,now())",job,id,owner)
        val progress="/internal/v1/preprocessing-jobs/${job}/progress"

        for(wrong in listOf(emptyMap(),operations,mapOf("X-Internal-Token" to "wrong-service-token-wrong-service-token"))) {
            assertEquals(403,call("POST",progress,wrong,report("extracting",0)).statusCode(),"${wrong.keys}")
        }
        val ok=call("POST",progress,internal,report("extracting",0))
        assertEquals(200,ok.statusCode(),ok.body())
        assertEquals(listOf("${job}","running"),listOf(node(ok).path("id").asString(),node(ok).path("status").asString()))
        assertEquals(422,call("POST",progress,internal,json.writeValueAsString(mapOf("stage" to "nope","done" to 0,"total" to 1,"failedEpisodes" to emptyList<Int>()))).statusCode())
        assertEquals(404,call("POST","/internal/v1/preprocessing-jobs/none/progress",internal,report("extracting",0)).statusCode())

        assertEquals(403,call("GET","/internal/v1/preprocessing-jobs",internal).statusCode(),"AI 토큰으로 운영 목록을 읽을 수 없다")
        assertEquals(403,call("GET","/internal/v1/preprocessing-jobs",emptyMap()).statusCode())
        // 목록의 출처는 V15 작업 행(manuscript_build_job)이다. 작업 행이 없는 골격 V41 행은 running이어도 목록에 나오지 않는다.
        fun listed(status:String):List<JsonNode> {
            val list=call("GET","/internal/v1/preprocessing-jobs?status=$status&size=100",operations)
            assertEquals(200,list.statusCode(),list.body())
            return node(list).path("items").toList().filter { it.path("workId").asString()==id }
        }
        assertEquals(emptyList<JsonNode>(),listed("running"))
        assertEquals(422,call("GET","/internal/v1/preprocessing-jobs?status=done",operations).statusCode())

        val failedReport=call("POST",progress,internal,report("extracting",0,"전처리 로직 미구현"))
        assertEquals("failed",node(failedReport).path("status").asString())
        assertEquals(409,call("POST",progress,internal,report("extracting",0)).statusCode())
        val retryPath="/internal/v1/preprocessing-jobs/${job}/retry"
        assertEquals(403,call("POST",retryPath,internal).statusCode(),"AI 토큰으로 재실행할 수 없다")
        val missing=call("POST",retryPath,operations)
        assertEquals(409,missing.statusCode(),missing.body())
        assertTrue(missing.body().contains("PREPROCESSING_SNAPSHOT_MISSING"))
        val current=service.start(id,owner)
        val jobId=UUID.fromString(current.id)
        val token=build.claim(jobId,id).getValue("token") as UUID
        assertEquals(listOf(current.id),listed("running").map { it.path("id").asString() },"V15 작업 행이 목록의 출처다")
        build.failed(jobId,token,"EXTRACTION_FAILED",listOf(1))
        val failedRow=listed("failed").single()
        assertEquals(listOf<Any?>(current.id,"failed",1,"EXTRACTION_FAILED",listOf(1)),listOf(failedRow.path("id").asString(),failedRow.path("status").asString(),
            failedRow.path("total").asInt(),failedRow.path("error").asString(),failedRow.path("failedEpisodes").toList().map { it.asInt() }))
        val currentRetry="/internal/v1/preprocessing-jobs/${current.id}/retry"
        val retried=call("POST",currentRetry,operations)
        assertEquals(202,retried.statusCode(),retried.body())
        assertEquals("queued",node(retried).path("status").asString())
        assertEquals(409,call("POST",currentRetry,operations).statusCode())
    }
}
