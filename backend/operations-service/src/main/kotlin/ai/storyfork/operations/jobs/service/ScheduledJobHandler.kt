package ai.storyfork.operations.jobs.service

/** What a finished run reports: progress and the target it acted on. A failure is an exception, never an outcome. */
data class JobOutcome(val done: Int? = null, val total: Int? = null, val targetId: String? = null)

/**
 * One bean per scheduled job [kind]. A schedule can only be registered for a kind that has a handler, and the scheduler
 * calls [run] on its own thread with the schedule's params. An exception fails the run with a fixed message and is logged,
 * so the handler should let upstream failures propagate instead of returning a made-up outcome.
 */
interface ScheduledJobHandler {
    val kind: String
    fun run(params: Map<String, Any?>): JobOutcome
}
