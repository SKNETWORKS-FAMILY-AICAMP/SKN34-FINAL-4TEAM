package ai.storyfork.operations.jobs

import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.entity.ScheduledJobEntity
import ai.storyfork.operations.jobs.service.JOB_FAILED_MESSAGE
import ai.storyfork.operations.jobs.service.JobExecutionService
import ai.storyfork.operations.jobs.service.JobOutcome
import ai.storyfork.operations.jobs.service.ScheduledJobHandler
import ai.storyfork.operations.jobs.service.dto.JobRun
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxy
import ch.qos.logback.core.read.ListAppender
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Fake repositories and handlers with a fixed clock: no Spring context, worker thread or database. */
class JobExecutionServiceTest {
    private val start = Instant.parse("2026-03-10T03:00:30Z")
    private val schedules = FakeSchedules()
    private val runs = FakeRuns()
    private val alpha = FakeJobHandler("alpha", JobOutcome(done = 3, total = 5, targetId = "target-1"))
    private val logger = LoggerFactory.getLogger(JobExecutionService::class.java) as Logger
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

    /** The throwable messages of every ERROR event the service logged. */
    private fun errorMessages() = logs.list.filter { it.level == Level.ERROR }.mapNotNull { (it.throwableProxy as? ThrowableProxy)?.throwable?.message }

    private fun service(vararg handlers: ScheduledJobHandler) =
        object : JobExecutionService(schedules.repository, runs.repository, handlers.toList()) {
            override fun now(): Instant = start
        }

    private fun schedule(kind: String = "alpha") =
        ScheduledJobEntity(kind = kind, cron = "0 0 3 * * *", enabled = true, params = mapOf("dataset" to "d1")).also { schedules.rows += it }

    private fun queued(schedule: ScheduledJobEntity, status: JobStatus = JobStatus.QUEUED) =
        JobRunEntity(scheduleId = schedule.id, kind = schedule.kind, trigger = JobTrigger.SCHEDULE, status = status, createdAt = start.minusSeconds(5)).also { runs.rows += it }

    @Test
    fun `a queued run is taken, runs its handler with the schedule params and ends succeeded with its progress and target`() {
        val run = queued(schedule())

        val result = service(alpha).execute(run.id)

        assertEquals(listOf(mapOf<String, Any?>("dataset" to "d1")), alpha.calls)
        // The claim moved the run to running in one update; only the result is saved here.
        assertEquals(listOf(JobStatus.SUCCEEDED), runs.savedStatuses)
        assertEquals(JobStatus.SUCCEEDED, run.status)
        assertEquals(listOf(3, 5, "target-1"), listOf(run.done, run.total, run.targetId))
        assertEquals(start, run.startedAt)
        assertEquals(start, run.finishedAt)
        assertNull(run.error)
        assertEquals(listOf(run.id.toString(), "succeeded", "operations-scheduler", "schedule"), listOf(result.id, result.status, result.source, result.trigger))
    }

    @Test
    fun `a run that is not queued is refused with 409 and neither run nor changed`() {
        val schedule = schedule()
        for (status in listOf(JobStatus.RUNNING, JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED)) {
            val run = queued(schedule, status)

            val refused = assertThrows(ResponseStatusException::class.java) { service(alpha).execute(run.id) }

            assertEquals(HttpStatus.CONFLICT, refused.statusCode, status.name)
            assertEquals(status, run.status)
            assertNull(run.startedAt)
            assertNull(run.finishedAt)
        }
        assertTrue(alpha.calls.isEmpty())
        assertTrue(runs.savedStatuses.isEmpty())
    }

    @Test
    fun `a run that does not exist is not found and nothing runs`() {
        assertThrows(NoSuchElementException::class.java) { service(alpha).execute(UUID.randomUUID()) }

        assertTrue(alpha.calls.isEmpty())
    }

    @Test
    fun `two workers taking the same queued run at once run its handler once`() {
        val run = queued(schedule())
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val held = object : ScheduledJobHandler {
            override val kind = "alpha"

            override fun run(params: Map<String, Any?>): JobOutcome {
                calls.incrementAndGet()
                entered.countDown()
                check(release.await(10, TimeUnit.SECONDS)) { "the winner was never released" }
                return JobOutcome(done = 1)
            }
        }
        val service = service(held)
        val together = CyclicBarrier(2)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val both = (1..2).map { pool.submit<JobRun> { together.await(10, TimeUnit.SECONDS); service.execute(run.id) } }

            // The one that lost the claim is refused at once while the winner is held inside its handler.
            assertTrue(entered.await(10, TimeUnit.SECONDS))
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (both.none { it.isDone } && System.nanoTime() < deadline) Thread.sleep(5)
            assertEquals(1, both.count { it.isDone })
            release.countDown()
            val outcomes = both.map { runCatching { it.get(10, TimeUnit.SECONDS) } }

            assertEquals(1, calls.get())
            assertEquals(listOf("succeeded"), outcomes.mapNotNull { it.getOrNull()?.status })
            val refused = ((outcomes.single { it.isFailure }.exceptionOrNull() as ExecutionException).cause as ResponseStatusException)
            assertEquals(HttpStatus.CONFLICT, refused.statusCode)
            assertEquals(JobStatus.SUCCEEDED, run.status)
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun `a failing handler is recorded as failed with the fixed message and the cause stays in the log`() {
        val failing = FakeJobHandler("beta", failure = IllegalStateException("secret upstream detail https://internal.example"))
        val run = queued(schedule("beta"))

        val result = service(failing).execute(run.id)

        assertEquals(JobStatus.FAILED, run.status)
        assertEquals(JOB_FAILED_MESSAGE, run.error)
        assertEquals(start, run.finishedAt)
        assertEquals(listOf("failed", JOB_FAILED_MESSAGE), listOf(result.status, result.error))
        assertEquals(listOf("secret upstream detail https://internal.example"), errorMessages())
    }

    @Test
    fun `a handler that throws an Error fails its run with the fixed message instead of leaving it running`() {
        val broken = FakeJobHandler("beta", failure = NoClassDefFoundError("com/example/Missing"))
        val run = queued(schedule("beta"))

        service(broken).execute(run.id)

        assertEquals(JobStatus.FAILED, run.status)
        assertEquals(JOB_FAILED_MESSAGE, run.error)
        assertEquals(start, run.finishedAt)
        assertEquals(listOf("com/example/Missing"), errorMessages())
    }

    @Test
    fun `a failed save of the result is retried once as a plain failed run so the schedule is not blocked`() {
        val run = queued(schedule())
        // The save of the successful result fails, like a database that is down for that call; the retry as a failed run goes through.
        runs.saveFailure = { saved -> if (saved.status == JobStatus.SUCCEEDED) IllegalStateException("result save failed") else null }

        val result = service(alpha).execute(run.id)

        assertEquals(listOf(JobStatus.FAILED), runs.savedStatuses)
        assertEquals(JobStatus.FAILED, run.status)
        assertEquals(JOB_FAILED_MESSAGE, run.error)
        assertEquals(listOf(null, null, null), listOf(run.done, run.total, run.targetId))
        assertEquals(start, run.finishedAt)
        assertEquals("failed", result.status)
        assertEquals(listOf("result save failed"), errorMessages())
    }

    @Test
    fun `when the retry save fails too both failures are logged and the worker still gets an answer`() {
        val run = queued(schedule())
        runs.saveFailure = { saved ->
            when (saved.status) {
                // Errors, not exceptions: a save that dies with one must not leave the run running either.
                JobStatus.SUCCEEDED -> LinkageError("result save failed")
                JobStatus.FAILED -> NoClassDefFoundError("retry save failed")
                else -> null
            }
        }

        service(alpha).execute(run.id)

        // The run stays running in the database (the startup sweep closes it later).
        assertTrue(runs.savedStatuses.isEmpty())
        assertEquals(listOf("result save failed", "retry save failed"), errorMessages())
    }

    @Test
    fun `a run whose handler is no longer registered fails instead of being skipped silently`() {
        val run = queued(schedule("gone"))

        service(alpha).execute(run.id)

        assertEquals(JobStatus.FAILED, run.status)
        assertEquals(JOB_FAILED_MESSAGE, run.error)
        assertTrue(alpha.calls.isEmpty())
    }

    @Test
    fun `a long target id from a handler is cut so the final save cannot fail and leave the run running`() {
        val verbose = FakeJobHandler("alpha", JobOutcome(targetId = "t".repeat(300)))
        val run = queued(schedule())

        service(verbose).execute(run.id)

        assertEquals(100, run.targetId?.length)
        assertEquals(JobStatus.SUCCEEDED, run.status)
    }
}
