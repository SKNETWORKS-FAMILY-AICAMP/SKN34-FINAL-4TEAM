package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.jobs.service.CONTENT_JOB_WINDOW
import ai.storyfork.operations.jobs.service.JobOutcome
import ai.storyfork.operations.jobs.service.JobScheduler
import ai.storyfork.operations.jobs.service.ScheduledJobHandler
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJobList
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

/**
 * CI-only HTTP/PostgreSQL coverage of Flyway V9 and V10, the real member Bearer chain with the `jobs` permission, the schedule CRUD,
 * the scheduler tick (called directly, as its own 1-minute timer is far slower than a test) and the merge with Content's jobs.
 * Core and Content are test doubles; cleanup touches only rows this test created.
 * A schedule uses a yearly cron and is back-dated two years to be due: the tick of another cached Spring context that shares
 * this database can then never find it due by itself, and a real clock cannot make it due twice.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "DATABASE_URL=\${TEST_OPERATIONS_DATABASE_URL}",
    "DATABASE_USER=\${TEST_OPERATIONS_DATABASE_USER:operations_test}",
    "DATABASE_PASSWORD=\${TEST_OPERATIONS_DATABASE_PASSWORD:}",
    "OPERATIONS_SERVICE_TOKEN=jobs-ci-service-token-not-a-production-secret",
])
@EnabledIfEnvironmentVariable(named = "TEST_OPERATIONS_DATABASE_URL", matches = ".+")
@Import(JobsIntegrationTest.Handlers::class)
class JobsIntegrationTest {
    /** Two handlers only this test context has: one succeeds with progress and the target from the schedule params, one always fails. */
    @TestConfiguration(proxyBeanMethods = false)
    class Handlers {
        @Bean
        fun okJobHandler(): ScheduledJobHandler = object : ScheduledJobHandler {
            override val kind = "ci_ok"
            override fun run(params: Map<String, Any?>) = JobOutcome(done = 2, total = 2, targetId = params["target"]?.toString())
        }

        @Bean
        fun failingJobHandler(): ScheduledJobHandler = object : ScheduledJobHandler {
            override val kind = "ci_fail"
            override fun run(params: Map<String, Any?>): JobOutcome = throw IllegalStateException("ci handler failure")
        }
    }

    @LocalServerPort private var port = 0
    @MockitoBean lateinit var core: CoreClient
    @MockitoBean lateinit var content: ContentClient
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var json: JsonMapper
    @Autowired private lateinit var scheduler: JobScheduler
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val base = "/api/v1/operations/jobs"
    private val serviceToken = "jobs-ci-service-token-not-a-production-secret"
    private val yearly = "0 0 0 1 1 *"

    private val runId = UUID.randomUUID().toString()
    private val createdSchedules = mutableListOf<UUID>()

    // Sample admin seeded by Core; operations V4 grants it every permission, including jobs.
    private val adminId = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    private val adminBearer = "Bearer admin-access"
    private val memberBearer = "Bearer member-access"
    private val operatorBearer = "Bearer operator-access"

    @BeforeEach
    fun doublesAnswer() {
        `when`(core.verify(adminBearer)).thenReturn(OperationsMember(adminId, true))
        `when`(core.verify(memberBearer)).thenReturn(OperationsMember(UUID.randomUUID(), false))
        // A Core operator that holds no permission row.
        `when`(core.verify(operatorBearer)).thenReturn(OperationsMember(UUID.randomUUID(), true))
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenReturn(ContentPreprocessingJobList(emptyList()))
    }

    @AfterEach
    fun cleanOnlyCreatedRows() {
        for (id in createdSchedules) {
            for (run in jdbc.queryForList("SELECT id FROM operations.job_run WHERE schedule_id = ?", UUID::class.java, id).filterNotNull()) {
                jdbc.update("DELETE FROM operations.admin_activity WHERE target_id = ?", run.toString())
            }
            jdbc.update("DELETE FROM operations.admin_activity WHERE target_id = ?", id.toString())
            jdbc.update("DELETE FROM operations.job_run WHERE schedule_id = ?", id)
            jdbc.update("DELETE FROM operations.scheduled_job WHERE id = ?", id)
        }
        jdbc.update("DELETE FROM operations.admin_activity WHERE target_id = ?", "job-$runId")
    }

    private fun send(method: String, path: String, bearer: String? = null, body: String? = null, withServiceToken: Boolean = false): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
            .timeout(Duration.ofSeconds(10)).header("Accept", "application/json")
        if (bearer != null) request.header("Authorization", bearer)
        if (withServiceToken) request.header("X-Operations-Service-Token", serviceToken)
        if (body != null) request.header("Content-Type", "application/json")
        val publisher = body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()
        return client.send(request.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun createSchedule(kind: String, params: String = "{}"): UUID {
        val response = send("POST", "$base/schedules", adminBearer, """{"kind":"$kind","cron":"$yearly","params":$params}""")
        assertEquals(201, response.statusCode(), response.body())
        return UUID.fromString(json.readTree(response.body()).path("id").asString()).also { createdSchedules.add(it) }
    }

    /** Back-dates the schedule so its yearly slot has passed and the next tick finds it due. */
    private fun makeDue(id: UUID) {
        val past = Timestamp.from(Instant.now().minus(730, ChronoUnit.DAYS))
        assertEquals(1, jdbc.update("UPDATE operations.scheduled_job SET created_at = ?, updated_at = ? WHERE id = ?", past, past, id))
    }

    // Jackson 3 JsonNode has its own member map(Function) that wins over Iterable.map, so iterate through values().
    private fun items(response: HttpResponse<String>) = json.readTree(response.body()).path("items").values().toList()

    private fun runsOf(kind: String, scheduleId: UUID): List<tools.jackson.databind.JsonNode> {
        val response = send("GET", "$base/runs?kind=$kind", adminBearer)
        assertEquals(200, response.statusCode(), response.body())
        val own = jdbc.queryForList("SELECT id FROM operations.job_run WHERE schedule_id = ?", UUID::class.java, scheduleId).filterNotNull().map { it.toString() }.toSet()
        return items(response).filter { it.path("id").asString() in own }
    }

    private fun activities(targetId: String) =
        jdbc.queryForList("SELECT action FROM operations.admin_activity WHERE target_id = ? ORDER BY created_at, id", String::class.java, targetId).filterNotNull()

    @Test
    fun `the jobs API needs a Core verified Bearer and the jobs permission`() {
        for (path in listOf("$base/runs", "$base/schedules")) {
            assertEquals(401, send("GET", path).statusCode(), path)
            // The service token only authorizes the service-to-server API, never this member route.
            assertEquals(401, send("GET", path, withServiceToken = true).statusCode(), path)
            assertEquals(403, send("GET", path, memberBearer).statusCode(), path)
            assertEquals(403, send("GET", path, operatorBearer).statusCode(), path)
            assertEquals(200, send("GET", path, adminBearer).statusCode(), path)
        }
        assertEquals(403, send("POST", "$base/schedules", operatorBearer, """{"kind":"ci_ok","cron":"$yearly"}""").statusCode())
    }

    @Test
    fun `schedules are created, listed, updated and only cancelled never deleted, each change recorded`() {
        val created = send("POST", "$base/schedules", adminBearer, """{"kind":"ci_ok","cron":"$yearly","params":{"target":"$runId"}}""")
        assertEquals(201, created.statusCode(), created.body())
        val id = UUID.fromString(json.readTree(created.body()).path("id").asString()).also { createdSchedules.add(it) }
        assertEquals("$base/schedules/$id", created.headers().firstValue("Location").orElse(""))
        assertTrue(json.readTree(created.body()).path("enabled").asBoolean())
        assertEquals(runId, json.readTree(created.body()).path("params").path("target").asString())

        // A kind without a handler and a cron that cannot be read or never fires are 422, and none of them is stored.
        for (body in listOf("""{"kind":"nope","cron":"$yearly"}""", """{"kind":"ci_ok","cron":"not a cron"}""", """{"kind":"ci_ok","cron":"0 0 0 31 2 *"}""")) {
            assertEquals(422, send("POST", "$base/schedules", adminBearer, body).statusCode(), body)
        }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM operations.scheduled_job WHERE id = ?", Int::class.java, id))

        val listed = send("GET", "$base/schedules", adminBearer)
        assertEquals(200, listed.statusCode(), listed.body())
        assertTrue(items(listed).any { it.path("id").asString() == id.toString() })

        val updated = send("PUT", "$base/schedules/$id", adminBearer, """{"kind":"ci_ok","cron":"0 0 0 2 1 *","enabled":false,"params":{"target":"changed"}}""")
        assertEquals(200, updated.statusCode(), updated.body())
        assertEquals("0 0 0 2 1 *", json.readTree(updated.body()).path("cron").asString())
        assertFalse(json.readTree(updated.body()).path("enabled").asBoolean())
        // A schedule keeps its kind.
        assertEquals(422, send("PUT", "$base/schedules/$id", adminBearer, """{"kind":"ci_fail","cron":"$yearly"}""").statusCode())
        assertEquals(404, send("PUT", "$base/schedules/${UUID.randomUUID()}", adminBearer, """{"kind":"ci_ok","cron":"$yearly"}""").statusCode())

        val cancelled = send("DELETE", "$base/schedules/$id", adminBearer)
        assertEquals(200, cancelled.statusCode(), cancelled.body())
        assertFalse(json.readTree(cancelled.body()).path("enabled").asBoolean())
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM operations.scheduled_job WHERE id = ? AND NOT enabled", Int::class.java, id))

        assertEquals(listOf("JOB_SCHEDULE_CREATE", "JOB_SCHEDULE_UPDATE", "JOB_SCHEDULE_CANCEL"), activities(id.toString()))
    }

    @Test
    fun `the tick runs a due schedule and the run list shows its progress and target`() {
        val id = createSchedule("ci_ok", """{"target":"$runId"}""")
        assertTrue(runsOf("ci_ok", id).isEmpty())
        makeDue(id)

        scheduler.tick()

        val run = runsOf("ci_ok", id).single()
        assertEquals(listOf("succeeded", "schedule", "operations-scheduler", "ci_ok", runId),
            listOf("status", "trigger", "source", "kind", "targetId").map { run.path(it).asString() })
        assertEquals(2, run.path("progress").path("done").asInt())
        assertEquals(2, run.path("progress").path("total").asInt())
        assertTrue(run.has("startedAt") && run.has("finishedAt"))
        assertFalse(run.has("error"))

        // The schedule list carries its latest run, and a second tick finds nothing due.
        val schedule = items(send("GET", "$base/schedules", adminBearer)).single { it.path("id").asString() == id.toString() }
        assertEquals("succeeded", schedule.path("lastRun").path("status").asString())
        scheduler.tick()
        assertEquals(1, runsOf("ci_ok", id).size)
    }

    @Test
    fun `a failed run is retried as a queued manual run that the next tick executes`() {
        val id = createSchedule("ci_fail")
        makeDue(id)
        scheduler.tick()
        val failed = runsOf("ci_fail", id).single()
        assertEquals("failed", failed.path("status").asString())
        assertEquals("작업을 실행하지 못했어요.", failed.path("error").asString())

        val retried = send("POST", "$base/runs/${failed.path("id").asString()}/retry", adminBearer)
        assertEquals(202, retried.statusCode(), retried.body())
        assertEquals(listOf("queued", "manual"), listOf("status", "trigger").map { json.readTree(retried.body()).path(it).asString() })
        // A schedule with an active run takes no second retry, and a run that did not fail takes none.
        assertEquals(409, send("POST", "$base/runs/${failed.path("id").asString()}/retry", adminBearer).statusCode())
        assertEquals(409, send("POST", "$base/runs/${json.readTree(retried.body()).path("id").asString()}/retry", adminBearer).statusCode())
        assertEquals(403, send("POST", "$base/runs/${failed.path("id").asString()}/retry", memberBearer).statusCode())

        scheduler.tick()

        val runs = runsOf("ci_fail", id)
        assertEquals(2, runs.size)
        assertEquals(setOf("failed"), runs.map { it.path("status").asString() }.toSet())
        assertEquals(setOf("schedule", "manual"), runs.map { it.path("trigger").asString() }.toSet())
        assertEquals(listOf("JOB_SCHEDULE_CREATE"), activities(id.toString()))
        assertEquals(listOf("JOB_RETRY"), activities(failed.path("id").asString()))

        // The re-run failed too, yet the first failed run stays re-run: it is refused for good, whatever its re-run did.
        assertEquals(409, send("POST", "$base/runs/${failed.path("id").asString()}/retry", adminBearer).statusCode())
        // The re-run is a record of its own: it failed, so it can be re-run once.
        val rerun = runs.single { it.path("trigger").asString() == "manual" }.path("id").asString()
        assertEquals(202, send("POST", "$base/runs/$rerun/retry", adminBearer).statusCode())
        assertEquals(409, send("POST", "$base/runs/$rerun/retry", adminBearer).statusCode())
        assertEquals(listOf("JOB_RETRY"), activities(rerun))
    }

    @Test
    fun `Content preprocessing jobs are merged into the list, named unavailable when Content fails, and retried through Content`() {
        val started = Instant.now().plusSeconds(3600)
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenReturn(ContentPreprocessingJobList(listOf(
            ContentPreprocessingJob("job-$runId", "work-1", "loading", 4, 10, listOf(2), started, null),
        )))

        val merged = send("GET", "$base/runs?kind=preprocessing", adminBearer)
        assertEquals(200, merged.statusCode(), merged.body())
        val job = items(merged).single { it.path("id").asString() == "job-$runId" }
        assertEquals(listOf("preprocessing", "content-preprocessing", "running", "user", "work-1"),
            listOf("kind", "source", "status", "trigger", "targetId").map { job.path(it).asString() })
        assertEquals(4, job.path("progress").path("done").asInt())
        assertTrue(json.readTree(merged.body()).path("unavailable").values().toList().isEmpty())

        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        val degraded = send("GET", "$base/runs", adminBearer)
        assertEquals(200, degraded.statusCode(), degraded.body())
        assertEquals(listOf("content-preprocessing"), json.readTree(degraded.body()).path("unavailable").values().toList().map { it.asString() })

        doReturn(ContentPreprocessingJob("job-$runId", "work-1", "queued", 4, 10, emptyList(), started, null)).`when`(content).retryPreprocessingJob("job-$runId")
        val retried = send("POST", "$base/runs/job-$runId/retry", adminBearer)
        assertEquals(202, retried.statusCode(), retried.body())
        assertEquals("queued", json.readTree(retried.body()).path("status").asString())
        assertEquals(listOf("JOB_RETRY"), activities("job-$runId"))
    }
}
