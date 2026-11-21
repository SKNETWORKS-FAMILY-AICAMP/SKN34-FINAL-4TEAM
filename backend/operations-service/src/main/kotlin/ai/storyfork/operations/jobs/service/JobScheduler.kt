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

/** Fixed message: the cause stays in the server log, never in the record an admin reads. */
const val JOB_INTERRUPTED_MESSAGE = "서비스가 다시 시작되어 작업이 중단됐어요."

/** Cron expressions are read in UTC. */
private val CRON_ZONE: ZoneId = ZoneOffset.UTC

/** The first slot of [cron] after [after]; null when it never fires again (for example February 31st). Throws for an invalid expression. */
internal fun nextRun(cron: String, after: Instant): Instant? = CronExpression.parse(cron).next(after.atZone(CRON_ZONE))?.toInstant()

/**
 * Plans the operations jobs: a 1-minute tick queues a run for every enabled schedule whose next slot has passed and hands it to the AI service ([JobDispatcher]),
 * whose workers run it through the execute API ([JobExecutionService]); the tick itself runs no handler.
 * ponytail: single instance only. The tick has no DB lock, so two instances would queue a schedule twice. To scale out or move to Airflow, replace this tick with
 * one planner and keep the job_run records.
 * ponytail: a run stays queued until a worker takes it, and a queued run holds its schedule. One whose message is lost (a purged queue, a crash between its save and
 * the hand-over) keeps the schedule blocked until it is failed by hand; sweep old queued runs here if that happens.
 */
@Component
class JobScheduler(
    private val schedules: ScheduledJobRepository,
    private val runs: JobRunRepository,
    private val dispatcher: JobDispatcher,
) {
    private val log = LoggerFactory.getLogger(JobScheduler::class.java)

    protected open fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    // The first tick waits a minute so a starting service (and a test context) is not touched at once.
    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    fun tick() {
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
        dispatcher.dispatch(run)
    }

    /** One broken schedule must not starve the others in the same tick. */
    private fun guarded(what: String, step: () -> Unit) = try {
        step()
    } catch (error: Exception) {
        log.error("Scheduler step failed: {}", what, error)
    }
}
