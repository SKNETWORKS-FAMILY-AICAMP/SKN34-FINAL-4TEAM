package ai.storyfork.operations.jobs.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.service.dto.CONTENT_PREPROCESSING
import ai.storyfork.operations.jobs.service.dto.JobPage
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.PREPROCESSING_KIND
import ai.storyfork.operations.jobs.service.dto.toRun
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import kotlin.jvm.optionals.getOrNull
import org.slf4j.LoggerFactory
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException

private const val JOBS = "jobs"

/** The newest Content preprocessing jobs read in one call; older ones are not listed. */
const val CONTENT_JOB_WINDOW = 100

/** A merged page reads this many newest rows from each source, so deeper pages are refused. */
private const val MERGE_LIMIT = 1000

private val NEWEST_FIRST = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))

/**
 * Lists the operations runs and Content's preprocessing jobs as one newest-first list and retries a failed run in its own source.
 * No service transaction: the repository calls use their own, so a slow Content call never holds a DB connection.
 */
@Service
class JobRunService(
    private val runs: JobRunRepository,
    private val content: ContentClient,
    private val schedules: ScheduleService,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    private val log = LoggerFactory.getLogger(JobRunService::class.java)

    /**
     * ponytail: each source supplies its newest (page + 1) * size rows and the merge slices the page, which is exact but reads more
     * on deeper pages. Content jobs are filtered here and limited to the newest [CONTENT_JOB_WINDOW]; pass status and page through
     * to Content when they outgrow that. A Content failure leaves the operations rows and is named in `unavailable`, never an empty list.
     */
    fun list(member: OperationsMember, status: String?, kind: String?, pageable: Pageable): JobPage<JobRun> {
        permissions.requirePermission(member, JOBS)
        val wanted = status?.let { JobStatus.valueOf(it.uppercase()) }
        val page = pageable.pageNumber
        val size = pageable.pageSize
        val limit = (page + 1) * size
        require(limit <= MERGE_LIMIT) { "page is too deep" }
        val own = own(wanted, kind, PageRequest.of(0, limit, NEWEST_FIRST))
        val (fromContent, unavailable) = preprocessing(wanted, kind)
        // Own runs sort by when they were queued, Content jobs by when they started; a Content job that has not started yet is the newest.
        val merged = (own.content.map { it.createdAt to it.toRun() } + fromContent.map { (it.startedAt ?: Instant.MAX) to it })
            .sortedByDescending { it.first }
        return JobPage(merged.drop(page * size).take(size).map { it.second }, page, size, own.totalElements + fromContent.size, unavailable)
    }

    /** An own run is queued for the scheduler; any other id is a Content job and goes back to Content, which retries only its failed episodes. */
    fun retry(member: OperationsMember, id: String): JobRun {
        permissions.requirePermission(member, JOBS)
        val own = runCatching { UUID.fromString(id) }.getOrNull()?.let { runs.findById(it).getOrNull() }
        if (own != null) return schedules.requeue(member, own)
        return content.retryPreprocessingJob(id).toRun().also { activities.record(member, "JOB_RETRY", "JOB_RUN", id, PREPROCESSING_KIND) }
    }

    private fun own(status: JobStatus?, kind: String?, page: Pageable) = when {
        status != null && kind != null -> runs.findAllByStatusAndKind(status, kind, page)
        status != null -> runs.findAllByStatus(status, page)
        kind != null -> runs.findAllByKind(kind, page)
        else -> runs.findAll(page)
    }

    private fun preprocessing(status: JobStatus?, kind: String?): Pair<List<JobRun>, List<String>> {
        if (kind != null && kind != PREPROCESSING_KIND) return emptyList<JobRun>() to emptyList()
        return try {
            content.preprocessingJobs(CONTENT_JOB_WINDOW).items.map { it.toRun() }
                .filter { status == null || it.status == status.name.lowercase() } to emptyList()
        } catch (error: ResponseStatusException) {
            log.warn("Content preprocessing jobs are unavailable: status={}", error.statusCode.value())
            emptyList<JobRun>() to listOf(CONTENT_PREPROCESSING)
        }
    }
}
