package ai.storyfork.operations.jobs

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.service.ScheduleService
import ai.storyfork.operations.jobs.service.dto.ScheduleRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Fake repositories, a mocked permission repository and activity service: no Spring context, HTTP or database. */
class ScheduleServiceTest {
    private val schedules = FakeSchedules()
    private val runs = FakeRuns()
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = ScheduleService(schedules.repository, runs.repository, listOf(FakeJobHandler("alpha")), permissions, activities)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutJobs = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val daily = "0 0 3 * * *"

    init {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, "jobs")).thenReturn(true)
        // A non-operator stays denied even with a stale grant row.
        `when`(permissions.existsByMemberIdAndPermission(staleGrant.memberId, "jobs")).thenReturn(true)
    }

    private fun stored(createdAt: Instant = Instant.parse("2026-03-01T00:00:00Z"), enabled: Boolean = true) =
        ScheduledJobEntity(kind = "alpha", cron = daily, enabled = enabled, params = mapOf("dataset" to "d1"), createdAt = createdAt)
            .also { schedules.rows += it }

    private fun failedRun(schedule: ScheduledJobEntity, status: JobStatus = JobStatus.FAILED, createdAt: Instant = Instant.parse("2026-03-02T03:00:00Z")) =
        JobRunEntity(scheduleId = schedule.id, kind = schedule.kind, trigger = JobTrigger.SCHEDULE, status = status, createdAt = createdAt,
            startedAt = createdAt, finishedAt = createdAt.plusSeconds(1), error = "실패").also { runs.rows += it }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    @Test
    fun `create saves an enabled schedule with empty params by default and records the admin activity`() {
        val before = Instant.now()

        val created = service.create(admin, ScheduleRequest("alpha", daily))

        val saved = schedules.rows.single()
        assertEquals(created.id, saved.id)
        assertEquals("alpha", created.kind)
        assertEquals(daily, created.cron)
        assertTrue(created.enabled)
        assertEquals(emptyMap<String, Any?>(), created.params)
        assertFalse(created.createdAt.isBefore(before.minusSeconds(1)))
        assertEquals(created.createdAt, created.updatedAt)
        assertNull(created.lastRun)
        verify(activities).record(admin, "JOB_SCHEDULE_CREATE", "JOB_SCHEDULE", created.id, "alpha · $daily")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `create keeps the given params and enabled flag`() {
        val created = service.create(admin, ScheduleRequest("alpha", daily, enabled = false, params = mapOf("dataset" to "d1", "limit" to 3)))

        assertFalse(created.enabled)
        assertEquals(mapOf("dataset" to "d1", "limit" to 3), schedules.rows.single().params)
    }

    @Test
    fun `a kind without a registered handler and a cron that is unreadable, too long or never fires are all 422, and nothing is saved`() {
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, status { service.create(admin, ScheduleRequest("gone", daily)) })

        // The last one is a readable cron that only the 100 character limit (the column width) refuses.
        for (cron in listOf("not a cron", "", "0 0 0 31 2 *", "0 ".repeat(60), daily.padEnd(101))) {
            assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, status { service.create(admin, ScheduleRequest("alpha", cron)) }, cron)
        }

        assertTrue(schedules.rows.isEmpty())
        verifyNoInteractions(activities)
    }

    @Test
    fun `a cron of exactly 100 characters is still accepted`() {
        service.create(admin, ScheduleRequest("alpha", daily.padEnd(100)))

        assertEquals(1, schedules.rows.size)
    }

    @Test
    fun `every operation is denied before the repositories unless an operator holds the jobs permission`() {
        val schedule = stored()
        for (denied in listOf(operatorWithoutJobs, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.list(denied) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.create(denied, ScheduleRequest("alpha", daily)) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.update(denied, schedule.id, ScheduleRequest("alpha", daily)) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.cancel(denied, schedule.id) })
        }

        assertEquals(1, schedules.rows.size)
        assertTrue(schedule.enabled)
        verifyNoInteractions(activities)
    }

    @Test
    fun `update replaces cron enabled and params, refreshes the update time and records the activity`() {
        val schedule = stored(enabled = false)
        val before = Instant.now()

        val updated = service.update(admin, schedule.id, ScheduleRequest("alpha", "0 30 4 * * *", enabled = true, params = mapOf("dataset" to "d2")))

        assertEquals("0 30 4 * * *", schedule.cron)
        assertTrue(schedule.enabled)
        assertEquals(mapOf("dataset" to "d2"), schedule.params)
        assertFalse(schedule.updatedAt.isBefore(before.minusSeconds(1)))
        assertEquals(Instant.parse("2026-03-01T00:00:00Z"), schedule.createdAt)
        assertEquals(schedule.id, updated.id)
        assertEquals("0 30 4 * * *", updated.cron)
        verify(activities).record(admin, "JOB_SCHEDULE_UPDATE", "JOB_SCHEDULE", schedule.id, "alpha · 0 30 4 * * *")
    }

    @Test
    fun `update cannot change the kind and an unknown schedule is not found`() {
        val schedule = stored()

        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, status { service.update(admin, schedule.id, ScheduleRequest("gone", daily)) })
        assertThrows(NoSuchElementException::class.java) { service.update(admin, UUID.randomUUID(), ScheduleRequest("alpha", daily)) }
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, status { service.update(admin, schedule.id, ScheduleRequest("alpha", "bad cron")) })

        assertEquals(daily, schedule.cron)
        verifyNoInteractions(activities)
    }

    @Test
    fun `cancel only turns the schedule off, keeps it and records the activity`() {
        val schedule = stored()

        val cancelled = service.cancel(admin, schedule.id)

        assertFalse(cancelled.enabled)
        assertFalse(schedule.enabled)
        assertEquals(1, schedules.rows.size)
        verify(activities).record(admin, "JOB_SCHEDULE_CANCEL", "JOB_SCHEDULE", schedule.id, "alpha · $daily")
        assertThrows(NoSuchElementException::class.java) { service.cancel(admin, UUID.randomUUID()) }
    }

    @Test
    fun `list returns the newest schedules first each with its latest run`() {
        val older = stored(Instant.parse("2026-03-01T00:00:00Z"))
        val newer = stored(Instant.parse("2026-03-05T00:00:00Z"))
        failedRun(older, JobStatus.SUCCEEDED, Instant.parse("2026-03-02T03:00:00Z"))
        val latest = failedRun(older, JobStatus.FAILED, Instant.parse("2026-03-03T03:00:00Z"))

        val page = service.list(admin)

        assertEquals(listOf(newer.id, older.id), page.items.map { it.id })
        assertNull(page.items[0].lastRun)
        assertEquals(latest.id.toString(), page.items[1].lastRun?.id)
        assertEquals("failed", page.items[1].lastRun?.status)
        assertEquals(listOf<Any>(0, 2, 2L, emptyList<String>()), listOf(page.page, page.size, page.total, page.unavailable))
    }

    @Test
    fun `requeue queues a manual run of the same schedule and records the retry against the failed run`() {
        val schedule = stored()
        val failed = failedRun(schedule)

        val queued = service.requeue(admin, failed)

        val saved = runs.rows.single { it.id != failed.id }
        assertEquals(schedule.id, saved.scheduleId)
        assertEquals("alpha", saved.kind)
        assertEquals(JobStatus.QUEUED, saved.status)
        assertEquals(JobTrigger.MANUAL, saved.trigger)
        assertEquals(failed.id, saved.retryOf)
        assertNull(failed.retryOf)
        assertNull(saved.startedAt)
        assertEquals(saved.id.toString(), queued.id)
        assertEquals(listOf("queued", "manual", "operations-scheduler"), listOf(queued.status, queued.trigger, queued.source))
        verify(activities).record(admin, "JOB_RETRY", "JOB_RUN", failed.id, "alpha")
    }

    @Test
    fun `requeue refuses a run that did not fail and a schedule that already has an active run`() {
        val schedule = stored()
        for (notFailed in listOf(JobStatus.SUCCEEDED, JobStatus.RUNNING, JobStatus.QUEUED, JobStatus.CANCELLED)) {
            assertEquals(HttpStatus.CONFLICT, status { service.requeue(admin, failedRun(schedule, notFailed)) }, notFailed.name)
        }
        runs.rows.clear()
        val failed = failedRun(schedule)
        failedRun(schedule, JobStatus.RUNNING, Instant.parse("2026-03-04T03:00:00Z"))

        assertEquals(HttpStatus.CONFLICT, status { service.requeue(admin, failed) })

        assertEquals(2, runs.rows.size)
        verifyNoInteractions(activities)
    }

    /** The run a retry queued, as the scheduler would find it in the repository. */
    private fun rerun(failed: JobRunEntity) = service.requeue(admin, failed).let { queued -> runs.rows.single { it.id.toString() == queued.id } }

    @Test
    fun `a failed run that was already re-run is 409 whatever its re-run is doing or did, and no second run is queued`() {
        val retried = mutableListOf<JobRunEntity>()
        for (outcome in listOf(JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED)) {
            runs.rows.clear()
            val failed = failedRun(stored()).also { retried += it }
            rerun(failed).status = outcome

            assertEquals(HttpStatus.CONFLICT, status { service.requeue(admin, failed) }, outcome.name)

            assertEquals(2, runs.rows.size, outcome.name)
        }
        // Only the five accepted retries were recorded, none of the refused ones.
        for (failed in retried) verify(activities).record(admin, "JOB_RETRY", "JOB_RUN", failed.id, "alpha")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `a re-run that failed can be re-run itself and so can a failed run that was never re-run, each record only once`() {
        val schedule = stored()
        val older = failedRun(schedule, createdAt = Instant.parse("2026-03-02T03:00:00Z"))
        val newer = failedRun(schedule, createdAt = Instant.parse("2026-03-03T03:00:00Z"))
        val first = rerun(newer).also { it.status = JobStatus.FAILED }
        val second = rerun(first).also { it.status = JobStatus.SUCCEEDED }
        // The older failure is not superseded by the newer runs: the contract only refuses a run in progress or already re-run.
        val third = rerun(older).also { it.status = JobStatus.FAILED }

        assertEquals(listOf(newer.id, first.id, older.id), listOf(first.retryOf, second.retryOf, third.retryOf))
        for (done in listOf(newer, first, older)) assertEquals(HttpStatus.CONFLICT, status { service.requeue(admin, done) }, done.id.toString())
        // The last re-run failed and nothing re-ran it yet.
        assertEquals(third.id, rerun(third).retryOf)
    }
}
