package ai.storyfork.operations.jobs

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.repository.ScheduledJobRepository
import ai.storyfork.operations.jobs.service.JobOutcome
import ai.storyfork.operations.jobs.service.ScheduledJobHandler
import java.time.Instant
import java.util.Optional
import org.mockito.Mockito.mock
import org.mockito.invocation.InvocationOnMock
import org.springframework.data.domain.Page
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.Pageable

/** Records the params it was called with and either returns [outcome] or throws [failure]. */
class FakeJobHandler(
    override val kind: String,
    private val outcome: JobOutcome = JobOutcome(),
    private val failure: Throwable? = null,
) : ScheduledJobHandler {
    val calls = mutableListOf<Map<String, Any?>>()

    override fun run(params: Map<String, Any?>): JobOutcome {
        calls += params
        failure?.let { throw it }
        return outcome
    }
}

private val newestFirst = compareByDescending<JobRunEntity> { it.createdAt }.thenByDescending { it.id }

/**
 * In-memory stand-in for [ScheduledJobRepository]: an unexpected repository call fails the test instead of returning null.
 * Writes are appended to [log] (shared with other fakes) so a test can see their order.
 */
class FakeSchedules(private val log: MutableList<String> = mutableListOf()) {
    val rows = mutableListOf<ScheduledJobEntity>()
    val repository: ScheduledJobRepository = mock(ScheduledJobRepository::class.java) { call ->
        when (call.method.name) {
            "findAllByEnabledTrue" -> rows.filter { it.enabled }
            "findAllByOrderByCreatedAtDescIdDesc" -> rows.sortedWith(compareByDescending<ScheduledJobEntity> { it.createdAt }.thenByDescending { it.id })
            "findById" -> Optional.ofNullable(rows.find { it.id == call.arguments[0] })
            "saveAndFlush" -> (call.arguments[0] as ScheduledJobEntity).also {
                log += "saveAndFlush"
                if (rows.none { row -> row.id == it.id }) rows += it
            }
            else -> throw UnsupportedOperationException(call.method.name)
        }
    }
}

/**
 * In-memory stand-in for [JobRunRepository]; [savedStatuses] is the status of the row at each save that went through (the claim is not a save),
 * [pageables] every page asked for. [saveFailure] makes a save throw before it is recorded, like a database that is down for that call.
 */
class FakeRuns(private val log: MutableList<String> = mutableListOf()) {
    val rows = mutableListOf<JobRunEntity>()
    var saveFailure: (JobRunEntity) -> Throwable? = { null }

    /** Runs inside the conditional close just before it looks at the status: what another thread does between a read and the close. */
    var beforeClose: (JobRunEntity) -> Unit = {}
    val savedStatuses = mutableListOf<JobStatus>()
    val pageables = mutableListOf<Pageable>()

    val repository: JobRunRepository = mock(JobRunRepository::class.java) { call ->
        val args = call.arguments
        when (call.method.name) {
            "save" -> (args[0] as JobRunEntity).also {
                saveFailure(it)?.let { error -> throw error }
                log += "save"
                savedStatuses += it.status
                if (rows.none { row -> row.id == it.id }) rows += it
            }
            "findById" -> Optional.ofNullable(rows.find { it.id == args[0] })
            // The conditional update: one atomic step that moves a run from the first status to the second and answers how many rows it changed.
            "claim" -> synchronized(rows) {
                val run = rows.find { it.id == args[0] }
                if (run != null && run.status == args[1]) {
                    run.status = args[2] as JobStatus
                    run.startedAt = args[3] as Instant
                    1
                } else 0
            }
            // The conditional close: failed only while the run is still in the status the caller read, so a late close never overwrites a later state.
            "close" -> synchronized(rows) {
                val run = rows.find { it.id == args[0] }
                if (run != null) {
                    beforeClose(run)
                    saveFailure(run)?.let { error -> throw error }
                }
                if (run != null && run.status == args[1]) {
                    run.status = args[2] as JobStatus
                    run.error = args[3] as String
                    run.finishedAt = args[4] as Instant
                    1
                } else 0
            }
            "findAllByStatusOrderByCreatedAtAscIdAsc" ->
                rows.filter { it.status == args[0] }.sortedWith(compareBy<JobRunEntity> { it.createdAt }.thenBy { it.id })
            "existsByScheduleIdAndStatusIn" -> rows.any { it.scheduleId == args[0] && it.status in (args[1] as Collection<*>) }
            "existsByRetryOf" -> rows.any { it.retryOf == args[0] }
            "findFirstByScheduleIdOrderByCreatedAtDescIdDesc" -> rows.filter { it.scheduleId == args[0] }.minWithOrNull(newestFirst)
            "findAllByStatus", "findAllByKind", "findAllByStatusAndKind", "findAll" -> page(call)
            else -> throw UnsupportedOperationException(call.method.name)
        }
    }

    private fun page(call: InvocationOnMock): Page<JobRunEntity> {
        val args = call.arguments
        val pageable = args.last() as Pageable
        pageables += pageable
        val matching = when (call.method.name) {
            "findAllByStatus" -> rows.filter { it.status == args[0] }
            "findAllByKind" -> rows.filter { it.kind == args[0] }
            "findAllByStatusAndKind" -> rows.filter { it.status == args[0] && it.kind == args[1] }
            else -> rows.toList()
        }.sortedWith(newestFirst)
        return PageImpl(matching.drop(pageable.offset.toInt()).take(pageable.pageSize), pageable, matching.size.toLong())
    }
}
