package ai.storyfork.operations.jobs

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.jobs.entity.JobRunEntity
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.entity.JobTrigger
import ai.storyfork.operations.jobs.service.CONTENT_JOB_WINDOW
import ai.storyfork.operations.jobs.service.JobDispatcher
import ai.storyfork.operations.jobs.service.JobRunService
import ai.storyfork.operations.jobs.service.ScheduleService
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJobList
import ai.storyfork.operations.jobs.service.dto.JobRun
import ai.storyfork.operations.jobs.service.dto.toRun
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.dto.Evaluation
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Fake run repository, mocked Content client, schedule service and activity service: no Spring context, HTTP or database. */
class JobRunServiceTest {
    private val runs = FakeRuns()
    private val content = mock(ContentClient::class.java)
    private val scheduleService = mock(ScheduleService::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val evaluations = mock(EvaluationService::class.java)
    private val dispatcher = mock(JobDispatcher::class.java)
    private val service = JobRunService(runs.repository, content, scheduleService, permissions, activities, evaluations, dispatcher)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutJobs = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val t = Instant.parse("2026-03-10T00:00:00Z")
    private val firstPage = PageRequest.of(0, 20)
    private val now = t.plusSeconds(100_000)

    init {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, "jobs")).thenReturn(true)
        `when`(permissions.existsByMemberIdAndPermission(staleGrant.memberId, "jobs")).thenReturn(true)
    }

    private fun own(seconds: Long, status: JobStatus = JobStatus.SUCCEEDED, kind: String = "alpha") =
        JobRunEntity(scheduleId = UUID.randomUUID(), kind = kind, trigger = JobTrigger.SCHEDULE, status = status,
            createdAt = t.plusSeconds(seconds), startedAt = t.plusSeconds(seconds)).also { runs.rows += it }

    private fun job(id: String, status: String, seconds: Long? = null, failedEpisodes: List<Int> = emptyList(), finishedSeconds: Long? = null) =
        ContentPreprocessingJob(id, "work-$id", status, 3, 10, failedEpisodes, seconds?.let { t.plusSeconds(it) }, finishedSeconds?.let { t.plusSeconds(it) })

    private fun contentJobs(vararg jobs: ContentPreprocessingJob) {
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenReturn(ContentPreprocessingJobList(jobs.toList()))
    }

    private fun evaluation(name: String, status: String, seconds: Long) =
        Evaluation(name, "qa-regression", "qa", 3, status, if (status == "completed") true else null, t.plusSeconds(seconds), emptyList())

    private fun givenEvaluations(vararg items: Evaluation) {
        `when`(evaluations.recent(now)).thenReturn(items.toList())
    }

    private fun ids(runs: List<JobRun>) = runs.map { it.id }

    @Test
    fun `list merges own and Content runs newest first and slices the requested page`() {
        val a1 = own(1)
        val a3 = own(3)
        val a5 = own(5)
        contentJobs(job("c2", "running", 2), job("c4", "completed", 4))

        val first = service.list(admin, null, null, PageRequest.of(0, 3))
        val second = service.list(admin, null, null, PageRequest.of(1, 3))

        assertEquals(listOf(a5.id.toString(), "c4", a3.id.toString()), ids(first.items))
        assertEquals(listOf("c2", a1.id.toString()), ids(second.items))
        assertEquals(listOf(5L, 5L), listOf(first.total, second.total))
        assertEquals(listOf(0 to 3, 1 to 3), listOf(first.page to first.size, second.page to second.size))
        assertTrue(first.unavailable.isEmpty())
        // Each source must supply the newest (page + 1) * size rows so the merged slice is exact.
        assertEquals(listOf(3, 6), runs.pageables.map { it.pageSize })
        assertTrue(runs.pageables.all { it.pageNumber == 0 && it.sort == Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")) })
    }

    @Test
    fun `the evaluation runs are merged with the others newest first by their creation time and counted in the total`() {
        val a1 = own(1)
        contentJobs(job("c2", "running", 2))
        givenEvaluations(evaluation("qa@v4", "running", 4), evaluation("qa@v3", "completed", 3))

        val page = service.list(admin, null, null, firstPage, now)

        assertEquals(listOf("qa@v4", "qa@v3", "c2", a1.id.toString()), ids(page.items))
        assertEquals(4L, page.total)
        assertTrue(page.unavailable.isEmpty())
        val running = page.items.first()
        assertEquals(listOf("evaluation", "ai-evaluation", "running", "qa@v4"), listOf(running.kind, running.source, running.status, running.targetId))
        assertEquals("succeeded", page.items[1].status)
    }

    @Test
    fun `an evaluation source that cannot be read leaves the other runs and is named unavailable, after Content when both fail`() {
        val a1 = own(1)
        contentJobs(job("c2", "running", 2))
        `when`(evaluations.recent(now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        val page = service.list(admin, null, null, firstPage, now)

        assertEquals(listOf("c2", a1.id.toString()), ids(page.items))
        assertEquals(2L, page.total)
        assertEquals(listOf("ai-evaluation"), page.unavailable)

        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        val both = service.list(admin, null, null, firstPage, now)

        assertEquals(listOf(a1.id.toString()), ids(both.items))
        assertEquals(listOf("content-preprocessing", "ai-evaluation"), both.unavailable)
    }

    @Test
    fun `a kind that is not evaluation never reads the evaluations and the evaluation kind reads only them`() {
        val a1 = own(1)
        contentJobs(job("c2", "running", 2))
        givenEvaluations(evaluation("qa@v4", "running", 4))

        assertEquals(listOf(a1.id.toString()), ids(service.list(admin, null, "alpha", firstPage, now).items))
        assertEquals(listOf("c2"), ids(service.list(admin, null, "preprocessing", firstPage, now).items))
        verifyNoInteractions(evaluations)

        assertEquals(listOf("qa@v4"), ids(service.list(admin, null, "evaluation", firstPage, now).items))
        verify(content, times(1)).preprocessingJobs(CONTENT_JOB_WINDOW)
    }

    @Test
    fun `the status filter uses the run vocabulary on the evaluation runs too`() {
        givenEvaluations(evaluation("e-run", "running", 1), evaluation("e-done", "completed", 2), evaluation("e-fail", "failed", 3))

        fun idsWith(status: String) = ids(service.list(admin, status, "evaluation", firstPage, now).items).toSet()

        assertEquals(setOf("e-run"), idsWith("running"))
        assertEquals(setOf("e-done"), idsWith("succeeded"))
        assertEquals(setOf("e-fail"), idsWith("failed"))
        assertEquals(emptySet<String>(), idsWith("queued"))
    }

    @Test
    fun `a queued Content job without a start time is the newest run`() {
        own(1)
        contentJobs(job("waiting", "queued", null))

        assertEquals("waiting", service.list(admin, null, null, firstPage).items.first().id)
    }

    @Test
    fun `a Content job that never started sorts by its finish time and one with neither stays on top in Content's order`() {
        val a1 = own(1)
        val a5 = own(5)
        contentJobs(job("waiting-1", "queued"), job("waiting-2", "queued"), job("early-fail", "failed", seconds = null, finishedSeconds = 3))

        assertEquals(listOf("waiting-1", "waiting-2", a5.id.toString(), "early-fail", a1.id.toString()), ids(service.list(admin, null, null, firstPage).items))
    }

    @Test
    fun `a Content failure leaves the own runs and names the unavailable source instead of an empty or failed list`() {
        val a1 = own(1)
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        val page = service.list(admin, null, null, firstPage)

        assertEquals(listOf(a1.id.toString()), ids(page.items))
        assertEquals(1L, page.total)
        assertEquals(listOf("content-preprocessing"), page.unavailable)
    }

    @Test
    fun `a kind other than preprocessing never calls Content and preprocessing returns only Content runs`() {
        val a1 = own(1)
        contentJobs(job("c2", "running", 2))

        assertEquals(listOf(a1.id.toString()), ids(service.list(admin, null, "alpha", firstPage).items))
        verifyNoInteractions(content)

        assertEquals(listOf("c2"), ids(service.list(admin, null, "preprocessing", firstPage).items))
    }

    @Test
    fun `the status filter uses the run vocabulary on both sources, loading counting as running`() {
        val ownFailed = own(1, JobStatus.FAILED)
        val ownDone = own(2, JobStatus.SUCCEEDED)
        contentJobs(job("q", "queued"), job("r", "running", 3), job("l", "loading", 4), job("d", "completed", 5), job("f", "failed", 6))

        fun idsWith(status: String) = ids(service.list(admin, status, null, firstPage).items).toSet()

        assertEquals(setOf("r", "l"), idsWith("running"))
        assertEquals(setOf("q"), idsWith("queued"))
        assertEquals(setOf("d", ownDone.id.toString()), idsWith("succeeded"))
        assertEquals(setOf("f", ownFailed.id.toString()), idsWith("failed"))
        assertEquals(emptySet<String>(), idsWith("cancelled"))
    }

    @Test
    fun `a status that is not part of the run vocabulary and a page too deep to merge are rejected`() {
        assertThrows(IllegalArgumentException::class.java) { service.list(admin, "weird", null, firstPage) }
        assertThrows(IllegalArgumentException::class.java) { service.list(admin, null, null, PageRequest.of(50, 100)) }

        verifyNoInteractions(content)
    }

    @Test
    fun `listing is denied before the repository or Content unless an operator holds the jobs permission`() {
        own(1)
        for (denied in listOf(operatorWithoutJobs, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.list(denied, null, null, firstPage) }.statusCode)
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.retry(denied, "any") }.statusCode)
        }

        assertTrue(runs.pageables.isEmpty())
        verifyNoInteractions(content, scheduleService, activities, dispatcher)
    }

    @Test
    fun `retrying an own run queues it and only then hands it to the AI service`() {
        val failed = own(1, JobStatus.FAILED)
        val queued = JobRunEntity(scheduleId = failed.scheduleId, kind = "alpha", trigger = JobTrigger.MANUAL, retryOf = failed.id)
        `when`(scheduleService.requeue(admin, failed)).thenReturn(queued)
        `when`(dispatcher.dispatch(queued)).thenReturn(true)

        assertEquals(queued.toRun(), service.retry(admin, failed.id.toString()))

        // The requeue transaction commits the queued run before the AI service hears of it, so the worker that takes it finds it.
        val order = inOrder(scheduleService, dispatcher)
        order.verify(scheduleService).requeue(admin, failed)
        order.verify(dispatcher).dispatch(queued)
        verifyNoInteractions(content, activities)
    }

    @Test
    fun `a retry the AI service did not take is 502, and its queued run was already recorded as failed by the dispatcher`() {
        val failed = own(1, JobStatus.FAILED)
        val queued = JobRunEntity(scheduleId = failed.scheduleId, kind = "alpha", trigger = JobTrigger.MANUAL, retryOf = failed.id)
        `when`(scheduleService.requeue(admin, failed)).thenReturn(queued)
        `when`(dispatcher.dispatch(queued)).thenReturn(false)

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.retry(admin, failed.id.toString()) }.statusCode)

        verify(dispatcher).dispatch(queued)
    }

    @Test
    fun `retrying an id Content owns re-submits it to Content and records the activity only afterwards`() {
        `when`(content.retryPreprocessingJob("job-7")).thenReturn(job("job-7", "queued"))

        val run = service.retry(admin, "job-7")

        assertEquals(listOf("job-7", "queued", "content-preprocessing", "preprocessing"), listOf(run.id, run.status, run.source, run.kind))
        val order = inOrder(content, activities)
        order.verify(content).retryPreprocessingJob("job-7")
        order.verify(activities).record(admin, "JOB_RETRY", "JOB_RUN", "job-7", "preprocessing")
        verifyNoInteractions(scheduleService)
    }

    @Test
    fun `a Content rejection on retry reaches the caller and nothing is recorded`() {
        for (upstream in listOf(HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.BAD_GATEWAY)) {
            // doThrow: re-stubbing with when(content.retry...) would invoke the previous throwing stub.
            doThrow(ResponseStatusException(upstream)).`when`(content).retryPreprocessingJob("job-8")

            assertEquals(upstream, assertThrows(ResponseStatusException::class.java) { service.retry(admin, "job-8") }.statusCode)
        }

        verifyNoInteractions(activities)
    }
}
