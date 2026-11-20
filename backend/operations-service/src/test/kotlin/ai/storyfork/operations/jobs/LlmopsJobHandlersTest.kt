package ai.storyfork.operations.jobs

import ai.storyfork.operations.alert.service.AlertCleanupService
import ai.storyfork.operations.alert.service.LlmAlertCheckService
import ai.storyfork.operations.jobs.service.AlertCleanupJob
import ai.storyfork.operations.jobs.service.JobOutcome
import ai.storyfork.operations.jobs.service.LeakSampleCheckJob
import ai.storyfork.operations.jobs.service.LlmAlertCheckJob
import ai.storyfork.operations.jobs.service.RegressionEvalJob
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.LeakSampleCheckService
import ai.storyfork.operations.llmops.service.dto.EvaluationRequest
import ai.storyfork.operations.llmops.service.dto.EvaluationStartedResponse
import java.time.Duration
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*

/** Mocked services: each handler only binds its kind to the service that does the work. No Spring context, scheduler thread or database. */
class LlmopsJobHandlersTest {
    private val now = Instant.parse("2026-11-19T05:00:00Z")
    private val alerts = mock(LlmAlertCheckService::class.java)
    private val leak = mock(LeakSampleCheckService::class.java)
    private val evaluations = mock(EvaluationService::class.java)
    private val cleanup = mock(AlertCleanupService::class.java)
    private val alertJob = LlmAlertCheckJob(alerts)
    private val leakJob = LeakSampleCheckJob(leak)
    private val evalJob = RegressionEvalJob(evaluations)
    private val cleanupJob = AlertCleanupJob(cleanup)

    private fun anyInstant(): Instant = ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH
    private fun started(runName: String) = EvaluationStartedResponse(runName, "qa-regression", "qa/answer", 3, "running")

    @Test
    fun `the four jobs of the contract table have their kinds`() {
        assertEquals(listOf("llm_alert_check", "leak_sample_check", "regression_eval", "alert_cleanup"), listOf(alertJob, leakJob, evalJob, cleanupJob).map { it.kind })
    }

    @Test
    fun `the alert check reports how many alerts it raised and the cleanup how many it deleted`() {
        `when`(alerts.run(anyInstant())).thenReturn(3)
        `when`(cleanup.run(anyInstant())).thenReturn(4L)

        assertEquals(JobOutcome(done = 3), alertJob.run(emptyMap()))
        assertEquals(JobOutcome(done = 4), cleanupJob.run(mapOf("ignored" to "x")))
    }

    @Test
    fun `the leak check samples the hour before now unless the schedule picks another window`() {
        `when`(leak.run(now.minus(Duration.ofMinutes(60)), now)).thenReturn(2)
        `when`(leak.run(now.minus(Duration.ofMinutes(30)), now)).thenReturn(5)

        assertEquals(JobOutcome(done = 2), leakJob.run(emptyMap(), now))
        assertEquals(JobOutcome(done = 2), leakJob.run(mapOf("windowMinutes" to null), now))
        assertEquals(JobOutcome(done = 5), leakJob.run(mapOf("windowMinutes" to 30), now))
        assertEquals(JobOutcome(done = 5), leakJob.run(mapOf("windowMinutes" to "30"), now))
    }

    @Test
    fun `the scheduler's run of the leak check samples the hour that ends now`() {
        leakJob.run(emptyMap())

        val (from, to) = mockingDetails(leak).invocations.single { it.method.name == "run" }.arguments.filterIsInstance<Instant>()
        assertTrue(Duration.between(to, Instant.now()).abs() < Duration.ofSeconds(10), to.toString())
        assertEquals(Duration.ofMinutes(60), Duration.between(from, to))
    }

    @Test
    fun `a window that is not a whole number of minutes from 1 to 10080 fails the run before the check`() {
        for (bad in listOf(0, -5, 10081, "abc", 1.5, true, "")) {
            assertThrows(IllegalArgumentException::class.java, { leakJob.run(mapOf("windowMinutes" to bad), now) }, bad.toString())
        }

        verifyNoInteractions(leak)
    }

    @Test
    fun `a regression evaluation starts with the schedule's dataset prompt and version and reports the run name`() {
        `when`(evaluations.startRun(EvaluationRequest("qa-regression", "qa/answer", 3))).thenReturn(started("qa-answer-v3-20261119"))

        val outcome = evalJob.run(mapOf("dataset" to "qa-regression", "prompt" to "qa/answer", "version" to 3, "other" to "ignored"))

        assertEquals(JobOutcome(targetId = "qa-answer-v3-20261119"), outcome)
        assertEquals(JobOutcome(targetId = "qa-answer-v3-20261119"), evalJob.run(mapOf("dataset" to " qa-regression ", "prompt" to "qa/answer", "version" to "3")))
    }

    @Test
    fun `a missing or unusable dataset prompt or version fails the run before the AI service is asked`() {
        val complete = mapOf<String, Any?>("dataset" to "d", "prompt" to "p", "version" to 1)
        val bad = listOf(
            emptyMap(), complete - "dataset", complete - "prompt", complete - "version",
            complete + ("dataset" to ""), complete + ("dataset" to "  "), complete + ("prompt" to 5), complete + ("dataset" to listOf("d")),
            complete + ("version" to "x"), complete + ("version" to 1.5), complete + ("version" to 0), complete + ("version" to null),
        )

        for (params in bad) assertThrows(IllegalArgumentException::class.java, { evalJob.run(params) }, params.toString())

        verifyNoInteractions(evaluations)
    }
}
