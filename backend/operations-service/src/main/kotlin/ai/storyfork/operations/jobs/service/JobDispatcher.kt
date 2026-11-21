package ai.storyfork.operations.jobs.service

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/** Fixed message: the cause stays in the server log, never in the record an admin reads. */
const val JOB_NOT_ACCEPTED_MESSAGE = "작업을 AI 서비스에 접수하지 못했어요."

/**
 * Hands a queued run to the AI service, whose job workers execute it by calling the execute API ([JobExecutionService]). Both the scheduler (a run that came
 * due) and a manual retry use it, so a run is told to the AI service the same way whoever queued it.
 */
@Component
class JobDispatcher(private val runs: JobRunRepository, private val ai: AiClient) {
    private val log = LoggerFactory.getLogger(JobDispatcher::class.java)

    protected open fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    /**
     * True when the AI service took the run; it stays queued until a worker claims it. When the hand-over fails, whatever the reason, the run is recorded as failed
     * with a fixed message and this is false: a run nobody was told about must not stay queued, since a queued run holds its schedule.
     */
    fun dispatch(run: JobRunEntity): Boolean = try {
        ai.startJob(run.id, run.kind)
        true
    } catch (error: Exception) {
        log.error("The AI service did not take job run {} ({})", run.id, run.kind, error)
        run.status = JobStatus.FAILED
        run.error = JOB_NOT_ACCEPTED_MESSAGE
        run.finishedAt = now()
        runs.save(run)
        false
    }
}
