package ai.storyfork.operations.dashboard.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.alert.entity.AlertStatus
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.dashboard.service.dto.AiSummary
import ai.storyfork.operations.dashboard.service.dto.Dashboard
import ai.storyfork.operations.dashboard.service.dto.DashboardAi
import ai.storyfork.operations.dashboard.service.dto.DashboardJobs
import ai.storyfork.operations.dashboard.service.dto.DashboardPending
import ai.storyfork.operations.inquiry.repository.InquiryRepository
import ai.storyfork.operations.jobs.service.JobCountService
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.service.KST
import ai.storyfork.operations.llmops.service.UsageStats
import ai.storyfork.operations.llmops.service.usageStats
import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.repository.ReportRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException

/**
 * The operations dashboard for any operator. Each upstream source (Core, Langfuse, Content) can fail on its own: its card becomes null
 * and its name goes into unavailable, while the other cards still show. The database cards (waiting inquiries, received reports, open
 * alerts) never depend on an upstream. The jobs card adds Content's preprocessing jobs to the operations runs, so it follows Content.
 * The funnel (Content, whole period) is read last: its own failure leaves the cards Content already answered, and an earlier Content failure skips it.
 * Nothing is cached.
 */
@Service
class DashboardService(
    private val core: CoreClient,
    private val usage: AiUsageService,
    private val content: ContentClient,
    private val inquiries: InquiryRepository,
    private val reports: ReportRepository,
    private val alerts: OperationAlertRepository,
    private val jobCounts: JobCountService,
) {
    fun get(member: OperationsMember, authorization: String, now: Instant = Instant.now()): Dashboard {
        if (!member.operator) throw ResponseStatusException(HttpStatus.FORBIDDEN)
        val unavailable = mutableListOf<String>()
        // Only a failed upstream call (a ResponseStatusException) blanks a card; any other exception is a bug and still fails the request.
        // A source that already failed is not asked again, so the second card that depends on it goes null without another timeout.
        fun <T : Any> source(name: String, read: () -> T): T? {
            if (name in unavailable) return null
            return try {
                read()
            } catch (_: ResponseStatusException) {
                unavailable += name
                null
            }
        }
        val members = source("core") { core.memberStats(authorization) }
        val ai = source("langfuse") { aiSummaries(now) }
        val authorReviews = source("content") {
            content.operationsStats(now.minus(7, ChronoUnit.DAYS), now).let { it.pendingFeedbackReports + it.pendingEditSuggestions }
        }
        val jobs = source("content") { jobCounts.counts(now.minus(24, ChronoUnit.HOURS)).let { DashboardJobs(it.running, it.failed) } }
        val funnel = source("content") { content.funnel() }
        // Inquiries and reports are database values and always shown; only the author-review count follows Content's availability.
        val pending = DashboardPending(inquiries.countWaitingMemberInquiries(), reports.countByStatus(ReportStatus.RECEIVED), authorReviews)
        return Dashboard(members, ai, jobs, pending, alerts.countByStatus(AlertStatus.OPEN), funnel, unavailable)
    }

    /** "Today" is the Korean day; both figures come from one 7-day read of Langfuse. */
    private fun aiSummaries(now: Instant): DashboardAi {
        val week = usage.traceFacts(now.minus(7, ChronoUnit.DAYS), now)
        val startOfToday = now.atZone(KST).toLocalDate().atStartOfDay(KST).toInstant()
        return DashboardAi(week.filter { !it.timestamp.isBefore(startOfToday) }.usageStats().summary(), week.usageStats().summary())
    }

    private fun UsageStats.summary() =
        AiSummary(requests, failed, timeouts, failureRate, costUser, costPlatform)
}
