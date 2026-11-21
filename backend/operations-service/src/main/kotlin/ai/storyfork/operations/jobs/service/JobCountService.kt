package ai.storyfork.operations.jobs.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.jobs.entity.ACTIVE_JOB_STATUSES
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.service.dto.toRun
import ai.storyfork.operations.llmops.service.EvaluationService
import java.time.Instant
import org.springframework.stereotype.Service

/** Jobs in progress now and jobs that failed after a moment, over the scheduler's own runs and Content's preprocessing jobs. */
data class JobCounts(val running: Int, val failed: Int)

/**
 * The one count the dashboard's jobs card and the job_failed alert rule share, so the card and the alert never disagree. Content's list is read
 * once per call and a Content failure is the caller's ResponseStatusException to handle (the card goes null, the alert check records it).
 * It stands apart from JobRunService, which needs the schedules and so the handlers, one of which is the alert check that uses this count.
 * ponytail: Content's side counts only its newest [CONTENT_JOB_WINDOW] jobs; pass a status filter to Content when more than that are active.
 * The regression evaluation runs are counted apart by [evaluationCounts], so this count never depends on Langfuse.
 */
@Service
class JobCountService(private val runs: JobRunRepository, private val content: ContentClient, private val evaluations: EvaluationService) {
    fun counts(failedSince: Instant): JobCounts {
        // The jobs list's own mapping to the run vocabulary, so a Content job that is loading counts as running exactly as it shows there.
        val preprocessing = content.preprocessingJobs(CONTENT_JOB_WINDOW).items.map { it.toRun() }
        val running = runs.countByStatusIn(ACTIVE_JOB_STATUSES) + preprocessing.count { it.status == "queued" || it.status == "running" }
        val failed = runs.countByStatusAndFinishedAtAfter(JobStatus.FAILED, failedSince) +
            preprocessing.count { it.status == "failed" && it.finishedAt?.isAfter(failedSince) == true }
        return JobCounts(running.toInt(), failed.toInt())
    }

    /**
     * The regression evaluation runs the same way, from Langfuse's newest runs (the evaluation screen's 50): those running now and the failed ones that started
     * after [failedSince], since an evaluation has no finish time (one that went stale just before the moment is missed). The dashboard's jobs card adds this to
     * [counts]; the job_failed alert rule does not, so it keeps judging the jobs while Langfuse is down. A Langfuse failure is the caller's ResponseStatusException.
     */
    fun evaluationCounts(failedSince: Instant, now: Instant): JobCounts {
        val recent = evaluations.recent(now)
        return JobCounts(recent.count { it.status == "running" }, recent.count { it.status == "failed" && it.createdAt.isAfter(failedSince) })
    }
}
