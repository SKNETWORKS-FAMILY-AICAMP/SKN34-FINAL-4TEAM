package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.OPERATIONS_SCHEDULER
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.service.JOB_INTERRUPTED_MESSAGE
import ai.storyfork.operations.jobs.service.JOB_NOT_ACCEPTED_MESSAGE
import ai.storyfork.operations.jobs.service.JobDispatcher
import ai.storyfork.operations.jobs.service.JobScheduler
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxy
import ch.qos.logback.core.read.ListAppender
import java.time.Instant
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Fake repositories and a mocked AI client with a fixed clock: no Spring context, scheduler thread or database. */
class JobSchedulerTest {
    private val start = Instant.parse("2026-03-10T03:00:30Z")
    private val schedules = FakeSchedules()
    private val runs = FakeRuns()

    /** The kinds the AI service refuses to take. */
    private val refused = mutableSetOf<String>()
    private val ai = mock(AiClient::class.java) { call ->
        if (call.method.name == "startJob" && call.arguments[1] in refused) throw ResponseStatusException(HttpStatus.BAD_GATEWAY)
        null
    }
    private val dispatcher = object : JobDispatcher(runs.repository, ai) {
        override fun now(): Instant = start
    }
    private val logger = LoggerFactory.getLogger(JobScheduler::class.java) as Logger
    private val logs = ListAppender<ILoggingEvent>()

    @BeforeEach
    fun captureLogs() {
        logs.start()
        logger.addAppender(logs)
    }

    @AfterEach
    fun releaseLogs() {
        logger.detachAppender(logs)
    }

    /** The throwable messages of every ERROR event the scheduler logged. */
    private fun errorMessages() = logs.list.filter { it.level == Level.ERROR }.mapNotNull { (it.throwableProxy as? ThrowableProxy)?.throwable?.message }

    private fun scheduler() = object : JobScheduler(schedules.repository, runs.repository, dispatcher) {
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
    fun `a due schedule queues a scheduled run and hands it to the AI service instead of running it`() {
        val schedule = schedule()

        scheduler().tick()

        val saved = runs.rows.single()
        assertEquals(listOf(JobStatus.QUEUED), runs.savedStatuses)
        assertEquals(schedule.id, saved.scheduleId)
        assertEquals("alpha", saved.kind)
        assertEquals(OPERATIONS_SCHEDULER, saved.source)
        assertEquals(JobTrigger.SCHEDULE, saved.trigger)
        assertEquals(JobStatus.QUEUED, saved.status)
        assertEquals(start, saved.createdAt)
        assertNull(saved.startedAt)
        assertNull(saved.finishedAt)
        assertNull(saved.error)
        verify(ai).startJob(saved.id, "alpha")
        verifyNoMoreInteractions(ai)
    }

    @Test
    fun `a disabled schedule never queues anything`() {
        schedule(enabled = false)

        scheduler().tick()

        assertTrue(runs.rows.isEmpty())
        verifyNoInteractions(ai)
    }

    @Test
    fun `a schedule whose next slot is still ahead is left alone`() {
        val schedule = schedule()
        run(schedule, JobStatus.SUCCEEDED, startedAt = Instant.parse("2026-03-10T03:00:05Z"))

        scheduler().tick()

        assertEquals(1, runs.rows.size)
        verifyNoInteractions(ai)
    }

    @Test
    fun `a schedule that still has a running run is skipped`() {
        val schedule = schedule()
        run(schedule, JobStatus.RUNNING, startedAt = Instant.parse("2026-03-09T03:00:00Z"))

        scheduler().tick()

        assertEquals(1, runs.rows.size)
        verifyNoInteractions(ai)
    }

    @Test
    fun `a schedule with a queued run is left alone, so nothing is queued twice, handed over again or run by the tick`() {
        val schedule = schedule()
        val waiting = run(schedule, JobStatus.QUEUED, JobTrigger.MANUAL)

        scheduler().tick()

        assertSame(waiting, runs.rows.single())
        assertEquals(JobStatus.QUEUED, waiting.status)
        assertTrue(runs.savedStatuses.isEmpty())
        verifyNoInteractions(ai)
    }

    @Test
    fun `an edit or a re-enable restarts the cron clock instead of catching up an old slot`() {
        schedule(updatedAt = start.minusSeconds(10))

        scheduler().tick()

        assertTrue(runs.rows.isEmpty())
        verifyNoInteractions(ai)
    }

    @Test
    fun `a cron that never fires is never due`() {
        schedule(cron = "0 0 0 31 2 *")

        scheduler().tick()

        assertTrue(runs.rows.isEmpty())
    }

    @Test
    fun `a run the AI service refuses is failed with the fixed message and the next schedule is still queued`() {
        schedule(kind = "beta")
        schedule(kind = "alpha")
        refused += "beta"

        scheduler().tick()

        val byKind = runs.rows.associateBy { it.kind }
        assertEquals(JobStatus.FAILED, byKind.getValue("beta").status)
        assertEquals(JOB_NOT_ACCEPTED_MESSAGE, byKind.getValue("beta").error)
        assertEquals(start, byKind.getValue("beta").finishedAt)
        assertEquals(JobStatus.QUEUED, byKind.getValue("alpha").status)
        verify(ai).startJob(byKind.getValue("alpha").id, "alpha")
    }

    @Test
    fun `a schedule whose run cannot be saved is logged and does not stop the others`() {
        schedule(kind = "beta")
        schedule(kind = "alpha")
        runs.saveFailure = { run -> if (run.kind == "beta") IllegalStateException("database is down") else null }

        scheduler().tick()

        assertEquals(listOf("alpha"), runs.rows.map { it.kind })
        verify(ai).startJob(runs.rows.single().id, "alpha")
        assertEquals(listOf("database is down"), errorMessages())
    }

    @Test
    fun `a restart fails the runs it interrupted so their schedules are not blocked for good`() {
        val schedule = schedule()
        val interrupted = run(schedule, JobStatus.RUNNING, startedAt = start.minusSeconds(3600))
        val waiting = run(schedule, JobStatus.QUEUED, JobTrigger.MANUAL)

        scheduler().failInterruptedRuns()

        assertEquals(JobStatus.FAILED, interrupted.status)
        assertEquals(JOB_INTERRUPTED_MESSAGE, interrupted.error)
        assertEquals(start, interrupted.finishedAt)
        // A queued run is waiting in the AI service's queue for a worker, so the sweep leaves it.
        assertEquals(JobStatus.QUEUED, waiting.status)
        verifyNoInteractions(ai)
    }
}
