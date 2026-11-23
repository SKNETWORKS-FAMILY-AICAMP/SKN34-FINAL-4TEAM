package ai.storyfork.operations.jobs.service

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.jobs.entity.ACTIVE_JOB_STATUSES
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.repository.ScheduledJobRepository
import ai.storyfork.operations.jobs.service.dto.JobPage
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.Schedule
import ai.storyfork.operations.jobs.service.dto.ScheduleRequest
import ai.storyfork.operations.jobs.service.dto.toRun
import ai.storyfork.operations.jobs.service.dto.toSchedule
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException

private const val JOBS = "jobs"
private const val CRON_MAX = 100

/**
 * Schedule CRUD and the queueing of a manual retry. Everything here changes only the operations database, so each change and its
 * admin activity record commit in one transaction. The `jobs` permission is checked before any repository call;
 * [requeue] is called by [JobRunService.retry], which has already checked it and then hands the queued run to the AI service.
 */
@Service
class ScheduleService(
    private val schedules: ScheduledJobRepository,
    private val runs: JobRunRepository,
    handlers: List<ScheduledJobHandler>,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    private val kinds = handlers.map { it.kind }.toSet()

    /** ponytail: N+1 for each schedule's latest run; fine for a handful of schedules, query the latest run per schedule once when there are dozens. */
    @Transactional(readOnly = true)
    fun list(member: OperationsMember): JobPage<Schedule> {
        permissions.requirePermission(member, JOBS)
        val items = schedules.findAllByOrderByCreatedAtDescIdDesc().map { it.toSchedule(lastRun(it)) }
        return JobPage(items, 0, items.size, items.size.toLong())
    }

    @Transactional
    fun create(member: OperationsMember, request: ScheduleRequest): Schedule {
        permissions.requirePermission(member, JOBS)
        validate(request)
        val saved = schedules.saveAndFlush(ScheduledJobEntity(kind = request.kind, cron = request.cron, enabled = request.enabled, params = request.params))
        activities.record(member, "JOB_SCHEDULE_CREATE", "JOB_SCHEDULE", saved.id, summary(saved))
        return saved.toSchedule(null)
    }

    @Transactional
    fun update(member: OperationsMember, id: UUID, request: ScheduleRequest): Schedule {
        permissions.requirePermission(member, JOBS)
        val entity = schedules.findById(id).orElseThrow()
        validate(request)
        // A schedule keeps its kind: its runs and params belong to one handler.
        if (request.kind != entity.kind) throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY)
        entity.cron = request.cron
        entity.enabled = request.enabled
        entity.params = request.params
        return change(member, "JOB_SCHEDULE_UPDATE", entity)
    }

    /** Cancelling only turns the schedule off, so its run history stays and it can be turned on again with update. */
    @Transactional
    fun cancel(member: OperationsMember, id: UUID): Schedule {
        permissions.requirePermission(member, JOBS)
        val entity = schedules.findById(id).orElseThrow()
        entity.enabled = false
        return change(member, "JOB_SCHEDULE_CANCEL", entity)
    }

    /**
     * Queues a manual run for the schedule of a failed run and returns it, committed, for the caller to hand to the AI service whose worker executes it.
     * A run that did not fail, whose schedule has a queued or running run, or that was already re-run is 409. The queued run keeps the link in [JobRunEntity.retryOf], so a run
     * stays re-run whatever its re-run does, while a re-run that failed can itself be re-run.
     * ponytail: the checks and the insert are not atomic, so two clicks at once could queue two runs.
     */
    @Transactional
    fun requeue(member: OperationsMember, run: JobRunEntity): JobRunEntity {
        if (run.status != JobStatus.FAILED || runs.existsByRetryOf(run.id) || runs.existsByScheduleIdAndStatusIn(run.scheduleId, ACTIVE_JOB_STATUSES)) {
            throw ResponseStatusException(HttpStatus.CONFLICT)
        }
        val queued = JobRunEntity(scheduleId = run.scheduleId, kind = run.kind, trigger = JobTrigger.MANUAL, retryOf = run.id)
        runs.save(queued)
        activities.record(member, "JOB_RETRY", "JOB_RUN", run.id, run.kind)
        return queued
    }

    /** Saves the changed schedule with a new update time and records the admin activity in the same transaction. */
    private fun change(member: OperationsMember, action: String, entity: ScheduledJobEntity): Schedule {
        entity.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val saved = schedules.saveAndFlush(entity)
        activities.record(member, action, "JOB_SCHEDULE", saved.id, summary(saved))
        return saved.toSchedule(lastRun(saved))
    }

    private fun lastRun(schedule: ScheduledJobEntity) = runs.findFirstByScheduleIdOrderByCreatedAtDescIdDesc(schedule.id)?.toRun()

    private fun summary(schedule: ScheduledJobEntity) = "${schedule.kind} · ${schedule.cron}"

    /** An unregistered kind and a cron that cannot be read, is too long or never fires again are all 422. */
    private fun validate(request: ScheduleRequest) {
        if (request.kind !in kinds || !firesAgain(request.cron)) throw ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY)
    }

    private fun firesAgain(cron: String) = cron.length <= CRON_MAX && try { nextRun(cron, Instant.now()) != null } catch (_: IllegalArgumentException) { false }
}
