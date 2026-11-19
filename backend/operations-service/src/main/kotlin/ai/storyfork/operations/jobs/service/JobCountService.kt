package ai.storyfork.operations.jobs.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.jobs.entity.ACTIVE_JOB_STATUSES
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.service.dto.toRun
import java.time.Instant
import org.springframework.stereotype.Service

/** Jobs in progress now and jobs that failed after a moment, over the scheduler's own runs and Content's preprocessing jobs. */
data class JobCounts(val running: Int, val failed: Int)

/**
 * The one count the dashboard's jobs card and the job_failed alert rule share, so the card and the alert never disagree. Content's list is read
 * once per call and a Content failure is the caller's ResponseStatusException to handle (the card goes null, the alert check records it).
 * It stands apart from JobRunService, which needs the schedules and so the handlers, one of which is the alert check that uses this count.
 * ponytail: Content's side counts only its newest [CONTENT_JOB_WINDOW] jobs; pass a status filter to Content when more than that are active.
 */
@Service
class JobCountService(private val runs: JobRunRepository, private val content: ContentClient) {
    fun counts(failedSince: Instant): JobCounts {
        // The jobs list's own mapping to the run vocabulary, so a Content job that is loading counts as running exactly as it shows there.
        val preprocessing = content.preprocessingJobs(CONTENT_JOB_WINDOW).items.map { it.toRun() }
        val running = runs.countByStatusIn(ACTIVE_JOB_STATUSES) + preprocessing.count { it.status == "queued" || it.status == "running" }
        val failed = runs.countByStatusAndFinishedAtAfter(JobStatus.FAILED, failedSince) +
            preprocessing.count { it.status == "failed" && it.finishedAt?.isAfter(failedSince) == true }
        return JobCounts(running.toInt(), failed.toInt())
    }
}
