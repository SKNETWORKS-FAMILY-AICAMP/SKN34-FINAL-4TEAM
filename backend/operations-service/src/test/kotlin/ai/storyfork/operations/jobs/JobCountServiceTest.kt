package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.service.CONTENT_JOB_WINDOW
import ai.storyfork.operations.jobs.service.JobCountService
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJobList
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.dto.Evaluation
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
    private val evaluations = mock(EvaluationService::class.java)
    private val service = JobCountService(runs, content, evaluations)
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

    private fun evaluation(status: String, createdAt: Instant) = Evaluation("qa@v3-$status", "qa-regression", "qa", 3, status, null, createdAt, emptyList())

    @Test
    fun `the evaluation runs add their running ones and the failed ones that started after the moment`() {
        val since = now.minus(24, ChronoUnit.HOURS)
        // An evaluation has no finish time, so a failed one counts when it started after the moment: the first two do, the one exactly at it and the older one do not.
        `when`(evaluations.recent(now)).thenReturn(listOf(
            evaluation("running", now.minusSeconds(60)), evaluation("running", since.minusSeconds(60)), evaluation("completed", now.minusSeconds(60)),
            evaluation("failed", now.minusSeconds(60)), evaluation("failed", since.plusSeconds(1)), evaluation("failed", since), evaluation("failed", since.minusSeconds(1)),
        ))

        val counts = service.evaluationCounts(since, now)

        assertEquals(listOf(2, 2), listOf(counts.running, counts.failed))
        // The other sources are not asked: the shared count that the alert rule uses stays as it was.
        verifyNoInteractions(runs, content)
    }

    @Test
    fun `no evaluation run counts as zero and a Langfuse failure reaches the caller`() {
        assertEquals(listOf(0, 0), service.evaluationCounts(now, now).let { listOf(it.running, it.failed) })

        `when`(evaluations.recent(now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.evaluationCounts(now, now) }.statusCode)
    }
}
