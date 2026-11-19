package ai.storyfork.operations.dashboard.service.dto

import ai.storyfork.operations._common.client.MemberStats

/** [failureRate] is null when there was no request, so a quiet period is not shown as a 0% failure rate. */
data class AiSummary(
    val requests: Int, val failed: Int, val timeouts: Int, val failureRate: Double?, val costUser: Double, val costPlatform: Double,
)

data class DashboardAi(val today: AiSummary, val last7Days: AiSummary)

data class DashboardJobs(val running: Int, val failedLast24h: Int)

/** Waiting inquiries and received reports are operations database values; only [authorReviews] comes from Content, so only it can be null. */
data class DashboardPending(val inquiries: Long, val reports: Long, val authorReviews: Long?)

/** A card whose source failed is null and its source is named in [unavailable]; a failure is never shown as 0. */
data class Dashboard(
    val members: MemberStats?, val ai: DashboardAi?, val jobs: DashboardJobs?, val pending: DashboardPending,
    val openAlerts: Long, val unavailable: List<String>,
)
