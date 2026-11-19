package ai.storyfork.operations.jobs

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.OPERATIONS_SCHEDULER
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.service.JOB_FAILED_MESSAGE
import ai.storyfork.operations.jobs.service.JOB_INTERRUPTED_MESSAGE
import ai.storyfork.operations.jobs.service.JobOutcome
import ai.storyfork.operations.jobs.service.JobScheduler
import ai.storyfork.operations.jobs.service.ScheduledJobHandler
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Fake repositories and handlers with a fixed clock: no Spring context, scheduler thread or database. */
class JobSchedulerTest {
    private val start = Instant.parse("2026-03-10T03:00:30Z")
    private val schedules = FakeSchedules()
    private val runs = FakeRuns()
    private val alpha = FakeJobHandler("alpha", JobOutcome(done = 3, total = 5, targetId = "target-1"))

    private fun scheduler(vararg handlers: ScheduledJobHandler) =
        object : JobScheduler(schedules.repository, runs.repository, handlers.toList()) {
            override fun now(): Instant = start
        }

    /** Daily 03:00 UTC, created the day before, so its slot at 03:00 today has passed at [start]. */
    private fun schedule(
        kind: String = "alpha",
        cron: String = "0 0 3 * * *",
        createdAt: Instant = Instant.parse("2026-03-09T00:00:00Z"),
        updatedAt: Instant = createdAt,
        enabled: Boolean = true,
    ) = ScheduledJobEntity(kind = kind, cron = cron, enabled = enabled, params = mapOf("dataset" to "d1"), createdAt = createdAt, updatedAt = updatedAt)
        .also { schedules.rows += it }

    private fun run(
        schedule: ScheduledJobEntity, status: JobStatus, trigger: JobTrigger = JobTrigger.SCHEDULE, startedAt: Instant? = null, createdAt: Instant = startedAt ?: start.minusSeconds(5),
    ) = JobRunEntity(scheduleId = schedule.id, kind = schedule.kind, trigger = trigger, status = status, createdAt = createdAt, startedAt = startedAt)
        .also { runs.rows += it }

    @Test
    fun `a due schedule runs its handler with the schedule params and records queued then running then succeeded`() {
        val schedule = schedule()

        scheduler(alpha).tick()

        assertEquals(listOf(mapOf<String, Any?>("dataset" to "d1")), alpha.calls)
        assertEquals(listOf(JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.SUCCEEDED), runs.savedStatuses)
        val saved = runs.rows.single()
        assertEquals(schedule.id, saved.scheduleId)
        assertEquals("alpha", saved.kind)
        assertEquals(OPERATIONS_SCHEDULER, saved.source)
        assertEquals(JobTrigger.SCHEDULE, saved.trigger)
        assertEquals(JobStatus.SUCCEEDED, saved.status)
        assertEquals(3, saved.done)
        assertEquals(5, saved.total)
        assertEquals("target-1", saved.targetId)
        assertEquals(start, saved.startedAt)
        assertEquals(start, saved.finishedAt)
        assertNull(saved.error)
    }

    @Test
    fun `a disabled schedule never runs`() {
        schedule(enabled = false)

        scheduler(alpha).tick()

        assertTrue(alpha.calls.isEmpty())
        assertTrue(runs.rows.isEmpty())
    }

    @Test
    fun `a schedule whose next slot is still ahead is left alone`() {
        val schedule = schedule()
        run(schedule, JobStatus.SUCCEEDED, startedAt = Instant.parse("2026-03-10T03:00:05Z"))

        scheduler(alpha).tick()

        assertTrue(alpha.calls.isEmpty())
        assertEquals(1, runs.rows.size)
    }

    @Test
    fun `a schedule that still has a running run is skipped`() {
        val schedule = schedule()
        run(schedule, JobStatus.RUNNING, startedAt = Instant.parse("2026-03-09T03:00:00Z"))

        scheduler(alpha).tick()

        assertTrue(alpha.calls.isEmpty())
        assertEquals(1, runs.rows.size)
    }

    @Test
    fun `an edit or a re-enable restarts the cron clock instead of catching up an old slot`() {
        schedule(updatedAt = start.minusSeconds(10))

        scheduler(alpha).tick()

        assertTrue(alpha.calls.isEmpty())
        assertTrue(runs.rows.isEmpty())
    }

    @Test
    fun `a cron that never fires is never due`() {
        schedule(cron = "0 0 0 31 2 *")

        scheduler(alpha).tick()

        assertTrue(alpha.calls.isEmpty())
    }

    @Test
    fun `a failing handler is recorded as failed with the fixed message and the next schedule still runs`() {
        val failing = FakeJobHandler("beta", failure = IllegalStateException("secret upstream detail https://internal.example"))
        schedule(kind = "beta")
        schedule(kind = "alpha")

        scheduler(alpha, failing).tick()

        val byKind = runs.rows.associateBy { it.kind }
        assertEquals(JobStatus.FAILED, byKind.getValue("beta").status)
        assertEquals(JOB_FAILED_MESSAGE, byKind.getValue("beta").error)
        assertEquals(start, byKind.getValue("beta").finishedAt)
        assertEquals(JobStatus.SUCCEEDED, byKind.getValue("alpha").status)
        assertEquals(1, alpha.calls.size)
    }

    @Test
    fun `a schedule whose handler is no longer registered fails its run instead of being skipped silently`() {
        schedule(kind = "gone")

        scheduler(alpha).tick()

        val saved = runs.rows.single()
        assertEquals(JobStatus.FAILED, saved.status)
        assertEquals(JOB_FAILED_MESSAGE, saved.error)
        assertTrue(alpha.calls.isEmpty())
    }

    @Test
    fun `a queued manual run goes first with the params of its schedule and is not repeated by the cron`() {
        val schedule = schedule()
        val queued = run(schedule, JobStatus.QUEUED, JobTrigger.MANUAL)

        scheduler(alpha).tick()

        assertEquals(listOf(mapOf<String, Any?>("dataset" to "d1")), alpha.calls)
        assertEquals(1, runs.rows.size)
        assertSame(queued, runs.rows.single())
        assertEquals(JobStatus.SUCCEEDED, queued.status)
        assertEquals(JobTrigger.MANUAL, queued.trigger)
        assertEquals(start, queued.startedAt)
    }

    @Test
    fun `a long target id from a handler is cut so the final save cannot fail and leave the run running`() {
        val verbose = FakeJobHandler("alpha", JobOutcome(targetId = "t".repeat(300)))
        schedule()

        scheduler(verbose).tick()

        assertEquals(100, runs.rows.single().targetId?.length)
        assertEquals(JobStatus.SUCCEEDED, runs.rows.single().status)
    }

    @Test
    fun `a restart fails the runs it interrupted so their schedules are not blocked for good`() {
        val schedule = schedule()
        val interrupted = run(schedule, JobStatus.RUNNING, startedAt = start.minusSeconds(3600))
        val waiting = run(schedule, JobStatus.QUEUED, JobTrigger.MANUAL)

        scheduler(alpha).failInterruptedRuns()

        assertEquals(JobStatus.FAILED, interrupted.status)
        assertEquals(JOB_INTERRUPTED_MESSAGE, interrupted.error)
        assertEquals(start, interrupted.finishedAt)
        assertEquals(JobStatus.QUEUED, waiting.status)
        assertTrue(alpha.calls.isEmpty())
    }
}
