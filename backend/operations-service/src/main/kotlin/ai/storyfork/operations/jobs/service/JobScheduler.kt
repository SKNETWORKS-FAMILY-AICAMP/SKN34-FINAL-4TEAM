package ai.storyfork.operations.jobs.service

import ai.storyfork.operations.jobs.entity.ACTIVE_JOB_STATUSES
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.repository.ScheduledJobRepository
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.scheduling.support.CronExpression
import org.springframework.stereotype.Component

/** Fixed messages: the cause stays in the server log, never in the record an admin reads. */
const val JOB_FAILED_MESSAGE = "작업을 실행하지 못했어요."
const val JOB_INTERRUPTED_MESSAGE = "서비스가 다시 시작되어 작업이 중단됐어요."

private const val TARGET_ID_MAX = 100

/** Cron expressions are read in UTC. */
private val CRON_ZONE: ZoneId = ZoneOffset.UTC

/** The first slot of [cron] after [after]; null when it never fires again (for example February 31st). Throws for an invalid expression. */
internal fun nextRun(cron: String, after: Instant): Instant? = CronExpression.parse(cron).next(after.atZone(CRON_ZONE))?.toInstant()

/**
 * Runs the operations jobs: a 1-minute tick executes queued manual retries, then every enabled schedule whose next slot has passed.
 * ponytail: single instance only. The tick runs handlers one by one on the scheduler thread and has no DB lock, so two instances
 * would run a schedule twice. To scale out or move to Airflow, replace this tick with one executor and keep the job_run records.
 */
@Component
class JobScheduler(
    private val schedules: ScheduledJobRepository,
    private val runs: JobRunRepository,
    handlers: List<ScheduledJobHandler>,
) {
    private val log = LoggerFactory.getLogger(JobScheduler::class.java)
    private val handlers = handlers.associateBy { it.kind }

    protected open fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    // The first tick waits a minute so a starting service (and a test context) is not touched at once.
    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    fun tick() {
        runs.findAllByStatusOrderByCreatedAtAscIdAsc(JobStatus.QUEUED).forEach { guarded("run ${it.id}") { execute(it) } }
        schedules.findAllByEnabledTrue().forEach { guarded("schedule ${it.id}") { startIfDue(it) } }
    }

    /**
     * ponytail: with one instance a running row at startup can only be left by a crash, and it would block its schedule for good.
     * With several instances this would fail another instance's live run.
     */
    @EventListener(ApplicationReadyEvent::class)
    fun failInterruptedRuns() = guarded("restart sweep") {
        runs.findAllByStatusOrderByCreatedAtAscIdAsc(JobStatus.RUNNING).forEach {
            it.status = JobStatus.FAILED
            it.error = JOB_INTERRUPTED_MESSAGE
            it.finishedAt = now()
            runs.save(it)
        }
    }

    private fun startIfDue(schedule: ScheduledJobEntity) {
        if (runs.existsByScheduleIdAndStatusIn(schedule.id, ACTIVE_JOB_STATUSES)) return
        val last = runs.findFirstByScheduleIdOrderByCreatedAtDescIdDesc(schedule.id)
        // An edit or a re-enable restarts the clock, so a slot that passed while the schedule was off is not caught up.
        val from = maxOf(last?.let { it.startedAt ?: it.createdAt } ?: schedule.createdAt, schedule.updatedAt)
        val next = nextRun(schedule.cron, from) ?: return
        if (next.isAfter(now())) return
        val run = JobRunEntity(scheduleId = schedule.id, kind = schedule.kind, trigger = JobTrigger.SCHEDULE, createdAt = now())
        runs.save(run)
        execute(run)
    }

    private fun execute(run: JobRunEntity) {
        run.status = JobStatus.RUNNING
        run.startedAt = now()
        runs.save(run)
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

    /** One broken run or schedule must not starve the others in the same tick. */
    private fun guarded(what: String, step: () -> Unit) = try {
        step()
    } catch (error: Exception) {
        log.error("Scheduler step failed: {}", what, error)
    }
}
