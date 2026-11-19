package ai.storyfork.operations.dashboard

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentOperationsStats
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.EditSuggestionStats
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.MemberStats
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations._common.client.ProposalDecisionStats
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.dashboard.service.DashboardService
import ai.storyfork.operations.dashboard.service.dto.DashboardJobs
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import ai.storyfork.operations.jobs.entity.JobStatus
import ai.storyfork.operations.jobs.repository.JobRunRepository
import ai.storyfork.operations.jobs.service.CONTENT_JOB_WINDOW
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJobList
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.json
import ai.storyfork.operations.llmops.root
import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.repository.ReportRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked clients and repositories (the usage aggregation runs for real over a mocked Langfuse): no network, Spring context or database. */
class DashboardServiceTest {
    private val core = mock(CoreClient::class.java)
    private val langfuse = mock(LangfuseClient::class.java)
    private val content = mock(ContentClient::class.java)
    private val inquiries = mock(InquiryRepository::class.java)
    private val reports = mock(ReportRepository::class.java)
    private val alerts = mock(OperationAlertRepository::class.java)
    private val runs = mock(JobRunRepository::class.java)
    private val service = DashboardService(core, AiUsageService(langfuse), content, inquiries, reports, alerts, runs)

    private val operator = OperationsMember(UUID.randomUUID(), true)
    private val bearer = "Bearer admin-access"
    // 14:00 KST on 11-19, so "today" began at 2026-11-18T15:00:00Z.
    private val now = Instant.parse("2026-11-19T05:00:00Z")
    private val weekAgo = Instant.parse("2026-11-12T05:00:00Z")

    private val traces = listOf(
        root("old", "2026-11-18T14:59:59Z", "qa", "failed", 2.0),
        root("edge", "2026-11-18T15:00:00Z", "qa", "success", 1.0, metadata = mapOf("credit_reservation_id" to "r-1")),
        root("new", "2026-11-19T01:00:00Z", "writing", "timeout", 5.0),
    )
    // The cost is the model calls' (a root has none): 0.20, 0.10 and 0.40.
    private val usage = listOf(ObservationUsage("old", "gpt-5", 1, 1, 0.20), ObservationUsage("edge", "gpt-5", 1, 1, 0.10), ObservationUsage("new", "mini", 1, 1, 0.40))

    private val dayAgo = now.minus(24, ChronoUnit.HOURS)

    private fun job(status: String, finishedAt: Instant? = null) = ContentPreprocessingJob(id = "j-$status", workId = "w", status = status, finishedAt = finishedAt)

    // In progress: queued, running and loading. Failed in the last 24 hours: only the one that finished an hour ago.
    private val preprocessing = listOf(
        job("queued"), job("running"), job("loading"), job("completed", now.minusSeconds(60)),
        job("failed", now.minus(1, ChronoUnit.HOURS)), job("failed", now.minus(30, ChronoUnit.HOURS)), job("failed"),
    )

    private fun givenAllSources() {
        `when`(runs.countByStatusIn(listOf(JobStatus.QUEUED, JobStatus.RUNNING))).thenReturn(2L)
        `when`(runs.countByStatusAndFinishedAtAfter(JobStatus.FAILED, dayAgo)).thenReturn(1L)
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenReturn(ContentPreprocessingJobList(preprocessing))
        `when`(core.memberStats(bearer)).thenReturn(MemberStats(100, 5, 1))
        `when`(langfuse.allTraces(weekAgo, now)).thenReturn(traces)
        `when`(langfuse.observationUsage(weekAgo, now)).thenReturn(usage)
        `when`(content.operationsStats(weekAgo, now)).thenReturn(ContentOperationsStats(3, 4, ProposalDecisionStats(1, 2), EditSuggestionStats(1, 1)))
        `when`(inquiries.countWaitingMemberInquiries()).thenReturn(2L)
        `when`(reports.countByStatus(ReportStatus.RECEIVED)).thenReturn(5L)
        `when`(alerts.countByStatus("open")).thenReturn(3L)
    }

    @Test
    fun `only an operator reads the dashboard and nothing is called for anyone else`() {
        val denied = assertThrows(ResponseStatusException::class.java) { service.get(OperationsMember(UUID.randomUUID(), false), bearer, now) }

        assertEquals(HttpStatus.FORBIDDEN, denied.statusCode)
        verifyNoInteractions(core, langfuse, content, inquiries, reports, alerts, runs)
    }

    @Test
    fun `every source answering fills every card`() {
        givenAllSources()

        val dashboard = service.get(operator, bearer, now)

        assertEquals(MemberStats(100, 5, 1), dashboard.members)
        assertEquals(listOf(7L, 2L, 5L), listOf(dashboard.pending.authorReviews, dashboard.pending.inquiries, dashboard.pending.reports))
        assertEquals(3L, dashboard.openAlerts)
        // Own runs queued or running (2) plus Content jobs queued, running or loading (3); failed in 24 hours: one own run and one Content job.
        assertEquals(DashboardJobs(5, 2), dashboard.jobs)
        assertEquals(emptyList<String>(), dashboard.unavailable)
    }

    @Test
    fun `only queued running and loading Content jobs are in progress`() {
        givenAllSources()
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenReturn(ContentPreprocessingJobList(listOf(job("completed"), job("failed"), job("cancelled"), job("whatever"))))

        assertEquals(2, checkNotNull(service.get(operator, bearer, now).jobs).running)
    }

    @Test
    fun `a failed job counts for the last 24 hours only when it finished after that moment`() {
        givenAllSources()
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenReturn(ContentPreprocessingJobList(listOf(
            job("failed", dayAgo), job("failed", dayAgo.plusSeconds(1)), job("failed", null), job("completed", now),
        )))

        // The own count (1) comes from the repository query that is strictly after the same moment.
        assertEquals(2, checkNotNull(service.get(operator, bearer, now).jobs).failedLast24h)
    }

    @Test
    fun `today starts at the Korean midnight and the seven days are the rolling window`() {
        givenAllSources()

        val ai = checkNotNull(service.get(operator, bearer, now).ai)

        // today: edge (the boundary instant is today) and new.
        assertEquals(listOf(2, 0, 1), listOf(ai.today.requests, ai.today.failed, ai.today.timeouts))
        // A timeout is not a failure, so nothing failed today.
        assertEquals(0.0, checkNotNull(ai.today.failureRate), 1e-9)
        assertEquals(0.10, ai.today.costUser, 1e-9)
        assertEquals(0.40, ai.today.costPlatform, 1e-9)
        assertEquals(listOf(3, 1, 1), listOf(ai.last7Days.requests, ai.last7Days.failed, ai.last7Days.timeouts))
        assertEquals(1.0 / 3, checkNotNull(ai.last7Days.failureRate), 1e-9)
        assertEquals(0.10, ai.last7Days.costUser, 1e-9)
        assertEquals(0.60, ai.last7Days.costPlatform, 1e-9)
    }

    @Test
    fun `a quiet day is zeros and never a division by zero`() {
        givenAllSources()
        `when`(langfuse.allTraces(weekAgo, now)).thenReturn(emptyList())

        val ai = checkNotNull(service.get(operator, bearer, now).ai)

        assertEquals(listOf(0, 0, 0), listOf(ai.today.requests, ai.today.failed, ai.today.timeouts))
        // No request means no rate to show: null, not a 0% that would read as "all good".
        assertNull(ai.today.failureRate)
        assertNull(ai.last7Days.failureRate)
        assertEquals(0.0, ai.last7Days.costUser)
    }

    @Test
    fun `a failing source blanks only its own card and is named once`() {
        val failing = mapOf(
            "core" to { `when`(core.memberStats(bearer)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY)) },
            "langfuse" to { `when`(langfuse.allTraces(weekAgo, now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY)) },
            "content" to { `when`(content.operationsStats(weekAgo, now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY)) },
        )
        for ((source, breakIt) in failing) {
            // Re-stubbing a call that already throws would throw while stubbing, so every round starts from fresh mocks.
            reset(core, langfuse, content, inquiries, reports, alerts, runs)
            givenAllSources()
            breakIt()

            val dashboard = service.get(operator, bearer, now)

            assertEquals(listOf(source), dashboard.unavailable, source)
            // The jobs card adds Content's preprocessing jobs to the operations runs, so it follows Content.
            assertEquals(source == "content", dashboard.jobs == null, source)
            assertEquals(source == "core", dashboard.members == null, source)
            assertEquals(source == "langfuse", dashboard.ai == null, source)
            // Waiting inquiries and received reports are database values, so only the author-review count follows Content.
            assertEquals(listOf(2L, 5L), listOf(dashboard.pending.inquiries, dashboard.pending.reports), source)
            assertEquals(source == "content", dashboard.pending.authorReviews == null, source)
            // The database cards are never lost to an upstream failure, and a failure is never turned into a 0.
            assertEquals(3L, dashboard.openAlerts, source)
        }
    }

    @Test
    fun `a Langfuse answer that cannot be read blanks only the Langfuse card`() {
        givenAllSources()
        `when`(langfuse.allTraces(weekAgo, now)).thenReturn(listOf(json("""{"traceId":"old","startTime":"2026-11-18 14:59:59"}""")))

        val dashboard = service.get(operator, bearer, now)

        assertNull(dashboard.ai)
        assertEquals(listOf("langfuse"), dashboard.unavailable)
        assertEquals(MemberStats(100, 5, 1), dashboard.members)
        assertEquals(7L, dashboard.pending.authorReviews)
        assertEquals(3L, dashboard.openAlerts)
    }

    @Test
    fun `a Core answer with another status is unavailable too and all three failing names all three`() {
        `when`(core.memberStats(bearer)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(langfuse.allTraces(weekAgo, now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.operationsStats(weekAgo, now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(alerts.countByStatus("open")).thenReturn(0L)
        `when`(inquiries.countWaitingMemberInquiries()).thenReturn(4L)
        `when`(reports.countByStatus(ReportStatus.RECEIVED)).thenReturn(6L)

        val dashboard = service.get(operator, bearer, now)

        assertEquals(listOf("core", "langfuse", "content"), dashboard.unavailable)
        assertNull(dashboard.jobs)
        assertNull(dashboard.members)
        assertNull(dashboard.ai)
        assertEquals(listOf(4L, 6L), listOf(dashboard.pending.inquiries, dashboard.pending.reports))
        assertNull(dashboard.pending.authorReviews)
        assertEquals(0L, dashboard.openAlerts)
    }

    @Test
    fun `Content stats answering but the preprocessing job list failing blanks only the jobs card`() {
        givenAllSources()
        `when`(content.preprocessingJobs(CONTENT_JOB_WINDOW)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        val dashboard = service.get(operator, bearer, now)

        assertNull(dashboard.jobs)
        assertEquals(7L, dashboard.pending.authorReviews)
        assertEquals(listOf("content"), dashboard.unavailable)
    }

    @Test
    fun `once Content has failed its job list is not asked for a second timeout`() {
        givenAllSources()
        `when`(content.operationsStats(weekAgo, now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        val dashboard = service.get(operator, bearer, now)

        assertEquals(listOf("content"), dashboard.unavailable)
        assertNull(dashboard.jobs)
        verify(content, never()).preprocessingJobs(CONTENT_JOB_WINDOW)
    }

    @Test
    fun `a bug is not an unavailable source`() {
        givenAllSources()
        `when`(core.memberStats(bearer)).thenThrow(IllegalStateException("bug"))

        assertThrows(IllegalStateException::class.java) { service.get(operator, bearer, now) }
    }
}
