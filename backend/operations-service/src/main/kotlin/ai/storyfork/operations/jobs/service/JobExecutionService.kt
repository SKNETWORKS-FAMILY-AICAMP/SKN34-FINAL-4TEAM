package ai.storyfork.operations.jobs.service

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.repository.ScheduledJobRepository
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.toRun
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException

/** Fixed message: the cause stays in the server log, never in the record an admin reads. */
const val JOB_FAILED_MESSAGE = "작업을 실행하지 못했어요."

private const val TARGET_ID_MAX = 100

/**
 * Executes a queued job run for a worker of the AI service (the execute API) and records its result. Several workers can be told the same run (a task delivered
 * twice, or workers racing for it), so a run is taken with one conditional update (queued → running): only the winner runs the handler, any other is refused and
 * the run is left as it is. The handler runs on the caller's thread, so the worker's request lasts as long as the job.
 */
@Service
class JobExecutionService(
    private val schedules: ScheduledJobRepository,
    private val runs: JobRunRepository,
    handlers: List<ScheduledJobHandler>,
) {
    private val log = LoggerFactory.getLogger(JobExecutionService::class.java)
    private val handlers = handlers.associateBy { it.kind }

    protected open fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    /**
     * The finished run (a handler that fails is a failed run, not an error of this call). A run that does not exist is 404 and one that is not queued, because
     * another worker took it or it already finished, is 409; neither runs anything or changes the run.
     */
    fun execute(runId: UUID): JobRun {
        if (runs.claim(runId, JobStatus.QUEUED, JobStatus.RUNNING, now()) != 1) {
            runs.findById(runId).orElseThrow()
            throw ResponseStatusException(HttpStatus.CONFLICT)
        }
        val run = runs.findById(runId).orElseThrow()
        try {
            val handler = checkNotNull(handlers[run.kind]) { "No handler is registered for ${run.kind}" }
            val outcome = handler.run(schedules.findById(run.scheduleId).orElseThrow().params)
            run.status = JobStatus.SUCCEEDED
            run.done = outcome.done
            run.total = outcome.total
            run.targetId = outcome.targetId?.take(TARGET_ID_MAX)
        } catch (error: Throwable) {
            // Throwable, not Exception: an Error from a handler (a missing class, a stack overflow) must fail the run too,
            // or the run stays running and blocks its schedule until the next restart.
            log.error("Scheduled job failed: kind={} run={}", run.kind, run.id, error)
            run.status = JobStatus.FAILED
            run.error = JOB_FAILED_MESSAGE
        }
        run.finishedAt = now()
        saveResult(run)
        return run.toRun()
    }

    /**
     * A failed save of the result is retried once as a plain failed run (fixed message, no progress), because a run whose result
     * cannot be recorded is not a success. If that fails too only the log remains and the run stays running until the next restart sweep.
     */
    private fun saveResult(run: JobRunEntity) {
        try {
            runs.save(run)
        } catch (error: Throwable) {
            log.error("Saving the result of job run {} failed, recording it as failed", run.id, error)
            run.status = JobStatus.FAILED
            run.error = JOB_FAILED_MESSAGE
            run.done = null
            run.total = null
            run.targetId = null
            try {
                runs.save(run)
            } catch (again: Throwable) {
                log.error("Job run {} stays running until the next restart", run.id, again)
            }
        }
    }
}
