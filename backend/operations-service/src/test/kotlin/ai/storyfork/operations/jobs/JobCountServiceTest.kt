package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.service.CONTENT_JOB_WINDOW
import ai.storyfork.operations.jobs.service.JobCountService
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJobList
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked repository and Content client: no network, Spring context or database. */
class JobCountServiceTest {
    private val runs = mock(JobRunRepository::class.java)
    private val content = mock(ContentClient::class.java)
    private val service = JobCountService(runs, content)
    private val now = Instant.parse("2026-11-19T05:00:00Z")

    private fun job(status: String, finishedAt: Instant? = null) = ContentPreprocessingJob(id = "j-$status", workId = "w", status = status, finishedAt = finishedAt)

    private fun givenContent(vararg jobs: ContentPreprocessingJob) =
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenReturn(ContentPreprocessingJobList(jobs.toList()))

    @Test
    fun `running adds the operations runs queued or running to the Content jobs queued running or loading`() {
        `when`(runs.countByStatusIn(listOf(JobStatus.QUEUED, JobStatus.RUNNING))).thenReturn(2L)
        givenContent(job("queued"), job("running"), job("loading"), job("completed"), job("failed"), job("cancelled"), job("whatever"))

        assertEquals(5, service.counts(now).running)
    }

    @Test
    fun `failed adds the operations runs that failed after the moment to the Content jobs that failed after it`() {
        val since = now.minus(1, ChronoUnit.HOURS)
        `when`(runs.countByStatusAndFinishedAtAfter(JobStatus.FAILED, since)).thenReturn(2L)
        // Content: the first two finished after the moment; one exactly at it, one before it, one without a finish time, and two that did not fail do not count.
        givenContent(
            job("failed", now.minusSeconds(60)), job("failed", since.plusSeconds(1)), job("failed", since), job("failed", since.minusSeconds(1)),
            job("failed", null), job("completed", now), job("running", now),
        )

        assertEquals(4, service.counts(since).failed)
    }

    @Test
    fun `the moment is the caller's so another window counts another set`() {
        val hour = now.minus(1, ChronoUnit.HOURS)
        val day = now.minus(24, ChronoUnit.HOURS)
        `when`(runs.countByStatusAndFinishedAtAfter(JobStatus.FAILED, hour)).thenReturn(1L)
        `when`(runs.countByStatusAndFinishedAtAfter(JobStatus.FAILED, day)).thenReturn(5L)
        givenContent(job("failed", now.minusSeconds(60)), job("failed", now.minus(5, ChronoUnit.HOURS)))

        assertEquals(listOf(2, 7), listOf(service.counts(hour).failed, service.counts(day).failed))
    }

    @Test
    fun `Content's list is read once per call`() {
        givenContent(job("queued"), job("failed", now))

        service.counts(now)

        verify(content, times(1)).preprocessingJobs(CONTENT_JOB_WINDOW)
    }

    @Test
    fun `a Content failure reaches the caller`() {
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.counts(now) }.statusCode)
    }
}
