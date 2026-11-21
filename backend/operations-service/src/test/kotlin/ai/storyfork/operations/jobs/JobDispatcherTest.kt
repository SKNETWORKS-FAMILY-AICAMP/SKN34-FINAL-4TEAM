package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.service.JOB_NOT_ACCEPTED_MESSAGE
import ai.storyfork.operations.jobs.service.JobDispatcher
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Fake run repository and a mocked AI client with a fixed clock: no network, Spring context or database. */
class JobDispatcherTest {
    private val start = Instant.parse("2026-03-10T03:00:30Z")
    private val runs = FakeRuns()
    private val ai = mock(AiClient::class.java)
    private val dispatcher = object : JobDispatcher(runs.repository, ai) {
        override fun now(): Instant = start
    }

    private fun queued() = JobRunEntity(scheduleId = UUID.randomUUID(), kind = "alpha", trigger = JobTrigger.SCHEDULE, createdAt = start.minusSeconds(5)).also { runs.rows += it }

    @Test
    fun `an accepted run stays queued for a worker and nothing is saved`() {
        val run = queued()

        assertTrue(dispatcher.dispatch(run))

        verify(ai).startJob(run.id, "alpha")
        assertEquals(JobStatus.QUEUED, run.status)
        assertNull(run.error)
        assertTrue(runs.savedStatuses.isEmpty())
    }

    @Test
    fun `a run the AI service refused is recorded as failed with the fixed message and never waits for a worker`() {
        val run = queued()
        doThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY)).`when`(ai).startJob(run.id, "alpha")

        assertFalse(dispatcher.dispatch(run))

        assertEquals(listOf(JobStatus.FAILED), runs.savedStatuses)
        assertEquals(JobStatus.FAILED, run.status)
        assertEquals(JOB_NOT_ACCEPTED_MESSAGE, run.error)
        assertEquals(start, run.finishedAt)
        assertNull(run.startedAt)
    }

    @Test
    fun `any failure to hand the run over is recorded the same way, so a queued run never waits for a hand-over that did not happen`() {
        val run = queued()
        doThrow(IllegalStateException("connection pool is closed")).`when`(ai).startJob(run.id, "alpha")

        assertFalse(dispatcher.dispatch(run))

        assertEquals(listOf(JobStatus.FAILED, JOB_NOT_ACCEPTED_MESSAGE), listOf(run.status, run.error))
    }
}
