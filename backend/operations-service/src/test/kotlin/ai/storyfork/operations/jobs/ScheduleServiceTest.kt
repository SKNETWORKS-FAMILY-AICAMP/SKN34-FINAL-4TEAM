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
    fun `a kind without a registered handler is 422 and a bad or never firing cron is 400, and nothing is saved`() {
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, status { service.create(admin, ScheduleRequest("gone", daily)) })

        for (cron in listOf("not a cron", "", "0 0 0 31 2 *", "0 ".repeat(60))) {
            assertThrows(IllegalArgumentException::class.java, { service.create(admin, ScheduleRequest("alpha", cron)) }, cron)
        }

        assertTrue(schedules.rows.isEmpty())
        verifyNoInteractions(activities)
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
        assertThrows(IllegalArgumentException::class.java) { service.update(admin, schedule.id, ScheduleRequest("alpha", "bad cron")) }

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
}
