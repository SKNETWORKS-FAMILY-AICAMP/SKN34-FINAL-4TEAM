package ai.storyfork.operations.jobs.service

import ai.storyfork.operations.alert.service.AlertCleanupService
import ai.storyfork.operations.alert.service.LlmAlertCheckService
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.LeakSampleCheckService
import ai.storyfork.operations.llmops.service.dto.EvaluationRequest
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Component

/** The leak sampling reads the hour before the run unless the schedule's params give a `windowMinutes` (at most a week). */
private const val DEFAULT_WINDOW_MINUTES = 60
private const val MAX_WINDOW_MINUTES = 7 * 24 * 60

/** A positive whole number given as a number or a numeric string; null when absent. Anything else fails the run. */
private fun Map<String, Any?>.positive(key: String): Int? = this[key]?.let {
    it.toString().trim().toIntOrNull()?.takeIf { number -> number >= 1 } ?: throw IllegalArgumentException("$key must be a positive whole number")
}

private fun Map<String, Any?>.text(key: String): String =
    (this[key] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: throw IllegalArgumentException("$key is required")

/*
 * The four LLMOps jobs of the contract's scheduler table. Each only binds its kind to the service that does the work; a service failure
 * propagates, so the scheduler records the run as failed. JobOutcome.done is the number the service reports (alerts raised, answers judged
 * suspicious, alerts deleted); the evaluation job reports the Langfuse run name as the target.
 */

@Component
class LlmAlertCheckJob(private val check: LlmAlertCheckService) : ScheduledJobHandler {
    override val kind = "llm_alert_check"

    override fun run(params: Map<String, Any?>) = JobOutcome(done = check.run())
}

@Component
class LeakSampleCheckJob(private val check: LeakSampleCheckService) : ScheduledJobHandler {
    override val kind = "leak_sample_check"

    override fun run(params: Map<String, Any?>) = run(params, Instant.now())

    /** Samples the traces of the window that ends at [now]; the window is read before any call, so a bad param never reaches Langfuse. */
    internal fun run(params: Map<String, Any?>, now: Instant): JobOutcome {
        val minutes = params.positive("windowMinutes") ?: DEFAULT_WINDOW_MINUTES
        require(minutes <= MAX_WINDOW_MINUTES) { "windowMinutes is at most $MAX_WINDOW_MINUTES" }
        return JobOutcome(done = check.run(now.minus(minutes.toLong(), ChronoUnit.MINUTES), now))
    }
}

/**
 * ponytail: the run record means "the AI service accepted the evaluation" (202), not "the evaluation passed". The result is the Langfuse
 * Dataset Run, shown on the LLMOps evaluation screen; the run record's target links the two by the run name.
 */
@Component
class RegressionEvalJob(private val evaluations: EvaluationService) : ScheduledJobHandler {
    override val kind = "regression_eval"

    override fun run(params: Map<String, Any?>): JobOutcome {
        val request = EvaluationRequest(params.text("dataset"), params.text("prompt"), params.positive("version") ?: throw IllegalArgumentException("version is required"))
        return JobOutcome(targetId = evaluations.startRun(request).runId)
    }
}

@Component
class AlertCleanupJob(private val cleanup: AlertCleanupService) : ScheduledJobHandler {
    override val kind = "alert_cleanup"

    override fun run(params: Map<String, Any?>) = JobOutcome(done = cleanup.run().toInt())
}
