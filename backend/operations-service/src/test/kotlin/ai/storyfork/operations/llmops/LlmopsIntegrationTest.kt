package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentOperationsStats
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.EditSuggestionStats
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.MemberStats
import ai.storyfork.operations._common.client.ProposalDecisionStats
import ai.storyfork.operations.alert.service.AlertCleanupService
import ai.storyfork.operations.alert.service.AlertRaiser
import ai.storyfork.operations.llmops.entity.LeakCheckResultEntity
import ai.storyfork.operations.llmops.repository.LeakCheckResultRepository
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*
import org.springframework.amqp.core.Message
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * CI-only HTTP/PostgreSQL coverage of Flyway V8 (seeds and the partial unique index), the real member Bearer chain with the llm and jobs
 * permissions, alert raising/handling/cleanup, the jsonb leak results, the settings, the dashboard and the production gate.
 * Core, Content, Langfuse, AI and RabbitMQ are test doubles; cleanup touches only rows this test created or changed.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "DATABASE_URL=\${TEST_OPERATIONS_DATABASE_URL}",
    "DATABASE_USER=\${TEST_OPERATIONS_DATABASE_USER:operations_test}",
    "DATABASE_PASSWORD=\${TEST_OPERATIONS_DATABASE_PASSWORD:}",
    "OPERATIONS_SERVICE_TOKEN=llmops-ci-service-token-not-a-production-secret",
])
@EnabledIfEnvironmentVariable(named = "TEST_OPERATIONS_DATABASE_URL", matches = ".+")
class LlmopsIntegrationTest {
    @LocalServerPort private var port = 0
    @MockitoBean lateinit var core: CoreClient
    @MockitoBean lateinit var content: ContentClient
    @MockitoBean lateinit var langfuse: LangfuseClient
    @MockitoBean lateinit var ai: AiClient
    @MockitoBean lateinit var rabbit: RabbitTemplate
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var json: JsonMapper
    @Autowired private lateinit var raiser: AlertRaiser
    @Autowired private lateinit var cleanup: AlertCleanupService
    @Autowired private lateinit var leakResults: LeakCheckResultRepository
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val base = "/api/v1/operations"

    /** Every alert and leak result this test creates carries it, which is also how cleanup finds them. */
    private val runId = "it-" + UUID.randomUUID()
    private val startedAt = Instant.now().minusSeconds(5)

    // Sample admin seeded by Core; operations V4 grants it every permission, including llm and jobs.
    private val adminId = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    private val jobsOnlyId = UUID.randomUUID()
    private val adminBearer = "Bearer admin-access"
    private val jobsBearer = "Bearer jobs-access"
    private val operatorBearer = "Bearer operator-access"
    private val memberBearer = "Bearer member-access"

    @BeforeEach
    fun coreVerifiesTheTestBearers() {
        `when`(core.verify(adminBearer)).thenReturn(OperationsMember(adminId, true))
        `when`(core.verify(jobsBearer)).thenReturn(OperationsMember(jobsOnlyId, true))
        `when`(core.verify(operatorBearer)).thenReturn(OperationsMember(UUID.randomUUID(), true)) // a Core operator that holds no permission row
        `when`(core.verify(memberBearer)).thenReturn(OperationsMember(UUID.randomUUID(), false))
        jdbc.update("INSERT INTO operations.admin_permission (member_id, permission) VALUES (?, 'jobs')", jobsOnlyId)
    }

    @AfterEach
    fun cleanOnlyWhatThisTestTouched() {
        jdbc.update("DELETE FROM operations.operation_alert WHERE message LIKE ?", "$runId%")
        jdbc.update("DELETE FROM operations.leak_check_result WHERE trace_id LIKE ?", "$runId%")
        jdbc.update("DELETE FROM operations.admin_permission WHERE member_id = ?", jobsOnlyId)
        jdbc.update("UPDATE operations.alert_rule SET threshold = NULL, enabled = false, window_minutes = 60, updated_at = now() WHERE key = 'ai_failure_rate'")
        jdbc.update("UPDATE operations.llmops_setting SET value = '0.1' WHERE key = 'leak_sample_rate'")
        jdbc.update("DELETE FROM operations.admin_activity WHERE created_at >= ? AND action IN ('ALERT_RULE_UPDATE', 'ALERT_ACKNOWLEDGE', 'ALERT_RESOLVE', 'LLMOPS_SETTING_UPDATE', 'PROMPT_PROMOTE')",
            Timestamp.from(startedAt))
    }

    private fun send(method: String, path: String, bearer: String? = null, body: String? = null): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).timeout(Duration.ofSeconds(10)).header("Accept", "application/json")
        if (bearer != null) request.header("Authorization", bearer)
        if (body != null) request.header("Content-Type", "application/json")
        val publisher = body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()
        return client.send(request.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun tree(response: HttpResponse<String>): JsonNode = json.readTree(response.body())

    // Jackson 3 JsonNode has its own member map(Function) that wins over Iterable.map, so iterate through values().
    private fun items(response: HttpResponse<String>) = tree(response).path("items").values().toList()

    private fun count(sql: String, vararg args: Any): Long = jdbc.queryForObject(sql, Long::class.java, *args) ?: 0L

    private fun raised(rule: String, suffix: String, value: Double? = 1.0) = raiser.raise(rule, "$runId $suffix", value, null)

    @Test
    fun `V8 seeds six rules that are off and have no value and the default sample rate`() {
        val keys = jdbc.queryForList("SELECT key FROM operations.alert_rule ORDER BY key", String::class.java).filterNotNull()

        assertEquals(listOf("ai_daily_cost_usd", "ai_failure_rate", "ai_p95_latency_ms", "ai_timeout_rate", "job_failed", "leak_suspected"), keys)
        assertEquals(0L, count("SELECT count(*) FROM operations.alert_rule WHERE enabled OR threshold IS NOT NULL"))
        assertEquals("0.1", jdbc.queryForObject("SELECT value FROM operations.llmops_setting WHERE key = 'leak_sample_rate'", String::class.java))
    }

    @Test
    fun `alert rules need llm and a change is stored validated and recorded`() {
        assertEquals(401, send("GET", "$base/alerts/rules").statusCode())
        for (denied in listOf(operatorBearer, jobsBearer, memberBearer)) assertEquals(403, send("GET", "$base/alerts/rules", denied).statusCode(), denied)
        val listed = send("GET", "$base/alerts/rules", adminBearer)
        assertEquals(200, listed.statusCode(), listed.body())
        assertTrue(items(listed).size >= 6)

        val updated = send("PUT", "$base/alerts/rules/ai_failure_rate", adminBearer, """{"threshold":0.25,"windowMinutes":30,"enabled":true}""")

        assertEquals(200, updated.statusCode(), updated.body())
        assertEquals(0.25, tree(updated).path("threshold").asDouble())
        assertTrue(tree(updated).path("enabled").asBoolean())
        assertEquals(30L, count("SELECT window_minutes FROM operations.alert_rule WHERE key = 'ai_failure_rate'"))
        assertEquals(1L, count("SELECT count(*) FROM operations.admin_activity WHERE action = 'ALERT_RULE_UPDATE' AND target_id = 'ai_failure_rate' AND created_at >= ?", Timestamp.from(startedAt)))
        for (bad in listOf("""{"threshold":1.5,"windowMinutes":30,"enabled":true}""", """{"windowMinutes":30,"enabled":true}""", """{"threshold":0.2,"windowMinutes":0,"enabled":false}""")) {
            assertEquals(400, send("PUT", "$base/alerts/rules/ai_failure_rate", adminBearer, bad).statusCode(), bad)
        }
        assertEquals(404, send("PUT", "$base/alerts/rules/unknown_rule", adminBearer, """{"windowMinutes":30,"enabled":false}""").statusCode())
    }

    @Test
    fun `a rule keeps one unresolved alert is handled through the API and raises again after it is resolved`() {
        val first = checkNotNull(raised("job_failed", "first"))
        assertNull(raised("job_failed", "second"), "an open alert blocks the next one")
        // Both llm and jobs operators are recipients: the sample admin and the jobs-only member, one message each.
        val sends = mockingDetails(rabbit).invocations.filter { it.method.name == "send" }
        assertEquals(setOf(adminId.toString(), jobsOnlyId.toString()), sends.map { json.readTree((it.arguments[2] as Message).body).path("recipientId").asString() }.toSet())

        assertEquals(403, send("GET", "$base/alerts", operatorBearer).statusCode())
        val listed = send("GET", "$base/alerts?status=open", jobsBearer)
        assertEquals(200, listed.statusCode(), listed.body())
        assertTrue(items(listed).any { it.path("id").asString() == first.id.toString() })
        assertEquals(400, send("GET", "$base/alerts?status=closed", adminBearer).statusCode())

        val acknowledged = send("PUT", "$base/alerts/${first.id}", jobsBearer, """{"status":"acknowledged","note":"확인했어요"}""")
        assertEquals(200, acknowledged.statusCode(), acknowledged.body())
        assertEquals("acknowledged", tree(acknowledged).path("status").asString())
        assertEquals(409, send("PUT", "$base/alerts/${first.id}", jobsBearer, """{"status":"acknowledged"}""").statusCode())
        assertNull(raised("job_failed", "third"), "an acknowledged alert still blocks the next one")

        assertEquals(200, send("PUT", "$base/alerts/${first.id}", adminBearer, """{"status":"resolved"}""").statusCode())
        assertEquals(409, send("PUT", "$base/alerts/${first.id}", adminBearer, """{"status":"resolved"}""").statusCode())
        assertNotNull(raised("job_failed", "fourth"), "a resolved alert lets the next breach raise a new one")
        assertEquals(404, send("PUT", "$base/alerts/${UUID.randomUUID()}", adminBearer, """{"status":"resolved"}""").statusCode())
        assertEquals(1L, count("SELECT count(*) FROM operations.admin_activity WHERE action = 'ALERT_ACKNOWLEDGE' AND target_id = ? AND created_at >= ?", first.id.toString(), Timestamp.from(startedAt)))
    }

    @Test
    fun `the partial unique index refuses a second unresolved alert for the same rule`() {
        val insert = "INSERT INTO operations.operation_alert (id, rule_key, status, message, created_at) VALUES (?, 'leak_suspected', ?, ?, now())"
        jdbc.update(insert, UUID.randomUUID(), "resolved", "$runId resolved")
        jdbc.update(insert, UUID.randomUUID(), "open", "$runId open")

        assertThrows(DataIntegrityViolationException::class.java) { jdbc.update(insert, UUID.randomUUID(), "acknowledged", "$runId second") }
        jdbc.update(insert, UUID.randomUUID(), "resolved", "$runId another resolved")
        assertEquals(3L, count("SELECT count(*) FROM operations.operation_alert WHERE message LIKE ?", "$runId%"))
    }

    @Test
    fun `cleanup deletes only alerts resolved more than 90 days ago`() {
        val insert = "INSERT INTO operations.operation_alert (id, rule_key, status, message, created_at, acted_at) VALUES (?, 'leak_suspected', 'resolved', ?, now(), ?)"
        jdbc.update(insert, UUID.randomUUID(), "$runId old", Timestamp.from(Instant.now().minusSeconds(86400L * 100)))
        jdbc.update(insert, UUID.randomUUID(), "$runId recent", Timestamp.from(Instant.now().minusSeconds(86400L * 10)))

        assertTrue(cleanup.run() >= 1L)

        assertEquals(listOf("$runId recent"), jdbc.queryForList("SELECT message FROM operations.operation_alert WHERE message LIKE ?", String::class.java, "$runId%"))
    }

    @Test
    fun `leak results are stored as a jsonb array and listed for llm admins only`() {
        leakResults.saveAndFlush(LeakCheckResultEntity(traceId = "$runId-t1", workId = "w-1", matched = listOf("한서진", "별빛 열쇠"), suspected = true, reason = "그대로 말했어요"))

        assertEquals("array", jdbc.queryForObject("SELECT jsonb_typeof(matched) FROM operations.leak_check_result WHERE trace_id = ?", String::class.java, "$runId-t1"))
        assertEquals("""["한서진", "별빛 열쇠"]""", jdbc.queryForObject("SELECT matched::text FROM operations.leak_check_result WHERE trace_id = ?", String::class.java, "$runId-t1"))
        assertThrows(DataIntegrityViolationException::class.java) {
            leakResults.saveAndFlush(LeakCheckResultEntity(traceId = "$runId-t1", workId = "w-1", matched = emptyList(), suspected = false))
        }
        for (denied in listOf(operatorBearer, jobsBearer)) assertEquals(403, send("GET", "$base/llmops/leak-checks", denied).statusCode(), denied)
        val listed = send("GET", "$base/llmops/leak-checks", adminBearer)
        assertEquals(200, listed.statusCode(), listed.body())
        val mine = items(listed).single { it.path("traceId").asString() == "$runId-t1" }
        assertEquals(listOf("한서진", "별빛 열쇠"), mine.path("matched").values().map { it.asString() })
        assertTrue(mine.path("suspected").asBoolean())
    }

    @Test
    fun `the leak sample rate is read and changed by llm admins and recorded`() {
        assertEquals(0.1, tree(send("GET", "$base/llmops/settings", adminBearer)).path("leakSampleRate").asDouble())
        assertEquals(403, send("GET", "$base/llmops/settings", jobsBearer).statusCode())

        val updated = send("PUT", "$base/llmops/settings", adminBearer, """{"leakSampleRate":0.3}""")

        assertEquals(200, updated.statusCode(), updated.body())
        assertEquals("0.3", jdbc.queryForObject("SELECT value FROM operations.llmops_setting WHERE key = 'leak_sample_rate'", String::class.java))
        assertEquals(400, send("PUT", "$base/llmops/settings", adminBearer, """{"leakSampleRate":1.5}""").statusCode())
        assertEquals(403, send("PUT", "$base/llmops/settings", operatorBearer, """{"leakSampleRate":0.5}""").statusCode())
        assertEquals(1L, count("SELECT count(*) FROM operations.admin_activity WHERE action = 'LLMOPS_SETTING_UPDATE' AND created_at >= ?", Timestamp.from(startedAt)))
    }

    private fun anyInstant(): Instant = org.mockito.ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH

    private fun givenUpstreams() {
        `when`(core.memberStats(anyString())).thenReturn(MemberStats(100, 5, 1))
        `when`(langfuse.allTraces(anyInstant(), anyInstant())).thenReturn(emptyList())
        `when`(content.operationsStats(anyInstant(), anyInstant())).thenReturn(ContentOperationsStats(3, 4, ProposalDecisionStats(1, 2), EditSuggestionStats(1, 1)))
    }

    @Test
    fun `any operator reads the dashboard and a failing upstream blanks only its own card`() {
        givenUpstreams()
        assertEquals(401, send("GET", "$base/dashboard").statusCode())
        assertEquals(403, send("GET", "$base/dashboard", memberBearer).statusCode())

        val ok = send("GET", "$base/dashboard", operatorBearer)

        assertEquals(200, ok.statusCode(), ok.body())
        val dashboard = tree(ok)
        assertEquals(100, dashboard.path("members").path("total").asInt())
        assertEquals(7, dashboard.path("pending").path("authorReviews").asInt())
        assertTrue(dashboard.path("pending").path("inquiries").isNumber)
        assertTrue(dashboard.path("pending").path("reports").isNumber)
        assertTrue(dashboard.path("openAlerts").isNumber)
        assertEquals(0, dashboard.path("ai").path("today").path("requests").asInt())
        assertTrue(dashboard.path("jobs").isNull)
        assertEquals(listOf("jobs"), dashboard.path("unavailable").values().map { it.asString() })

        doThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY)).`when`(core).memberStats(anyString())
        val partial = tree(send("GET", "$base/dashboard", operatorBearer))
        assertTrue(partial.path("members").isNull)
        assertEquals(7, partial.path("pending").path("authorReviews").asInt())
        assertEquals(listOf("core", "jobs"), partial.path("unavailable").values().map { it.asString() })
    }

    @Test
    fun `a prompt is promoted only after a passing evaluation of that version`() {
        `when`(langfuse.prompt("it-prompt", 3)).thenReturn(json.readTree("""{"name":"it-prompt","version":3,"labels":["latest"]}"""))
        `when`(langfuse.datasetRuns()).thenReturn(emptyList())
        assertEquals(403, send("PUT", "$base/llmops/prompts/it-prompt/production", jobsBearer, """{"version":3}""").statusCode())

        val refused = send("PUT", "$base/llmops/prompts/it-prompt/production", adminBearer, """{"version":3}""")

        assertEquals(409, refused.statusCode(), refused.body())
        assertEquals("EVALUATION_REQUIRED", tree(refused).path("code").asString())
        verify(langfuse, never()).setPromptLabels("it-prompt", 3, listOf("production"))

        // The AI service starts a run with string metadata and writes the verdict as a run-level passed score when it finishes.
        `when`(langfuse.datasetRuns()).thenReturn(listOf(json.readTree(
            """{"id":"run-id-1","name":"run-1","datasetName":"qa","createdAt":"2026-11-19T01:00:00Z","metadata":{"prompt":"it-prompt","version":"3","dataset":"qa"}}""")))
        `when`(langfuse.runScores("run-id-1")).thenReturn(listOf(json.readTree(
            """{"name":"passed","value":1.0,"dataType":"BOOLEAN","metadata":{"failedItems":0,"totalItems":10}}""")))
        val promoted = send("PUT", "$base/llmops/prompts/it-prompt/production", adminBearer, """{"version":3}""")

        assertEquals(200, promoted.statusCode(), promoted.body())
        assertEquals(listOf("latest", "production"), tree(promoted).path("labels").values().map { it.asString() })
        verify(langfuse).setPromptLabels("it-prompt", 3, listOf("production"))
        assertEquals(1L, count("SELECT count(*) FROM operations.admin_activity WHERE action = 'PROMPT_PROMOTE' AND target_id = 'it-prompt' AND created_at >= ?", Timestamp.from(startedAt)))
    }

    @Test
    fun `the trace list passes the request id filter to Langfuse`() {
        `when`(langfuse.traces(null, null, emptyList(), null, "req-77", 1, 20)).thenReturn(json.readTree(
            """{"data":[{"id":"t-1","timestamp":"2026-11-19T01:00:00Z","tags":["feature:qa","status:success"],"metadata":{"request_id":"req-77"},"latency":1.5,"totalCost":0.01}],"meta":{"totalItems":1}}"""))
        assertEquals(403, send("GET", "$base/llmops/traces?requestId=req-77", jobsBearer).statusCode())

        val response = send("GET", "$base/llmops/traces?requestId=req-77", adminBearer)

        assertEquals(200, response.statusCode(), response.body())
        assertEquals(listOf("t-1"), items(response).map { it.path("id").asString() })
        assertEquals(1, tree(response).path("total").asInt())
        verify(langfuse).traces(null, null, emptyList(), null, "req-77", 1, 20)
    }
}
