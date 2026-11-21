package ai.storyfork.operations.jobs.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.service.dto.AI_EVALUATION
import ai.storyfork.operations.jobs.service.dto.CONTENT_PREPROCESSING
import ai.storyfork.operations.jobs.service.dto.EVALUATION_KIND
import ai.storyfork.operations.jobs.service.dto.JobPage
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.PREPROCESSING_KIND
import ai.storyfork.operations.jobs.service.dto.toRun
import ai.storyfork.operations.llmops.service.EvaluationService
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
 * Lists the operations runs, Content's preprocessing jobs and the regression evaluation runs as one newest-first list and retries a failed run in its own
 * source (an evaluation is never retried here: a new one starts on the evaluation screen).
 * No service transaction: the repository calls use their own, so a slow Content or Langfuse call never holds a DB connection.
 */
@Service
class JobRunService(
    private val runs: JobRunRepository,
    private val content: ContentClient,
    private val schedules: ScheduleService,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
    private val evaluations: EvaluationService,
) {
    private val log = LoggerFactory.getLogger(JobRunService::class.java)

    /**
     * ponytail: each source supplies its newest (page + 1) * size rows and the merge slices the page, which is exact but reads more
     * on deeper pages. Content jobs are filtered here and limited to the newest [CONTENT_JOB_WINDOW]; pass status and page through
     * to Content when they outgrow that. The evaluation runs are Langfuse's newest 50 (the evaluation screen's window), filtered here too. A Content or Langfuse
     * failure leaves the other rows and is named in `unavailable`, never an empty list.
     */
    fun list(member: OperationsMember, status: String?, kind: String?, pageable: Pageable): JobPage<JobRun> = list(member, status, kind, pageable, Instant.now())

    internal fun list(member: OperationsMember, status: String?, kind: String?, pageable: Pageable, now: Instant): JobPage<JobRun> {
        permissions.requirePermission(member, JOBS)
        val wanted = status?.let { JobStatus.valueOf(it.uppercase()) }
        val page = pageable.pageNumber
        val size = pageable.pageSize
        val limit = (page + 1) * size
        require(limit <= MERGE_LIMIT) { "page is too deep" }
        val own = own(wanted, kind, PageRequest.of(0, limit, NEWEST_FIRST))
        val (fromContent, contentUnavailable) = external(CONTENT_PREPROCESSING, PREPROCESSING_KIND, wanted, kind) {
            content.preprocessingJobs(CONTENT_JOB_WINDOW).items.map { it.toRun() }
        }
        val (fromEvaluations, evaluationUnavailable) = external(AI_EVALUATION, EVALUATION_KIND, wanted, kind) { evaluations.recent(now).map { it.toRun() } }
        val outside = fromContent + fromEvaluations
        // Own runs sort by when they were queued, the other sources' runs (which have no creation time) by when they started, else finished;
        // one with neither is the newest and keeps its source's own order (the sort is stable).
        val merged = (own.content.map { it.createdAt to it.toRun() } + outside.map { (it.startedAt ?: it.finishedAt ?: Instant.MAX) to it })
            .sortedByDescending { it.first }
        return JobPage(merged.drop(page * size).take(size).map { it.second }, page, size, own.totalElements + outside.size, contentUnavailable + evaluationUnavailable)
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

    /**
     * The runs of one other source, in the wanted status: none (and no call) when the kind filter names another source. A source that cannot be read
     * (a ResponseStatusException) gives no runs and is named [name] in the second list.
     */
    private fun external(name: String, sourceKind: String, status: JobStatus?, kind: String?, read: () -> List<JobRun>): Pair<List<JobRun>, List<String>> {
        if (kind != null && kind != sourceKind) return emptyList<JobRun>() to emptyList()
        return try {
            read().filter { status == null || it.status == status.name.lowercase() } to emptyList()
        } catch (error: ResponseStatusException) {
            log.warn("{} runs are unavailable: status={}", name, error.statusCode.value())
            emptyList<JobRun>() to listOf(name)
        }
    }
}
