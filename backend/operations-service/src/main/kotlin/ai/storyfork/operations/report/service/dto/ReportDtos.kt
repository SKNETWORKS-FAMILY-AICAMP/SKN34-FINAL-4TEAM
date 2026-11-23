package ai.storyfork.operations.report.service.dto

import ai.storyfork.operations.report.entity.ReportHistoryType
import ai.storyfork.operations.report.entity.ReportKind
import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.entity.ReportTarget
import com.fasterxml.jackson.annotation.JsonInclude
import java.time.Instant
import java.util.UUID

/**
 * [targetType] defaults to a work report. A `work` report needs [workId], an `episode` report [workId] and [episodeNumber], a `world` report [worldId];
 * the ids a type does not ask for are ignored.
 */
data class ReportRequest(
    val kind: ReportKind,
    val workId: UUID?,
    val reason: String,
    val evidence: String = "",
    val targetType: ReportTarget = ReportTarget.WORK,
    val episodeNumber: Int? = null,
    val worldId: UUID? = null,
)

data class ReportBodyRequest(val body: String)

data class ReportReviewRequest(val decision: ReportStatus, val note: String)

data class ReportHistoryResponse(val id: UUID, val type: ReportHistoryType, val actorId: UUID, val body: String?, val createdAt: Instant)

data class ReportResponse(
    val id: UUID,
    val kind: ReportKind,
    val targetType: ReportTarget,
    /** [workId], [workTitle] and [workOwnerId] are null for a world report, which has [worldId] and [worldName] instead; [episodeNumber] is only set for an episode report. */
    val workId: UUID?,
    val workTitle: String?,
    val workOwnerId: UUID?,
    val episodeNumber: Int?,
    val worldId: UUID?,
    val worldName: String?,
    val reporterId: UUID,
    val reason: String,
    val evidence: String,
    val status: ReportStatus,
    val contentRestricted: Boolean,
    val createdAt: Instant,
    val updatedAt: Instant,
    /** Present only in detail responses; omitted from lists. */
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val history: List<ReportHistoryResponse>? = null,
)

data class ReportListResponse(val items: List<ReportResponse>)

data class ReportHistoryListResponse(val items: List<ReportHistoryResponse>)
