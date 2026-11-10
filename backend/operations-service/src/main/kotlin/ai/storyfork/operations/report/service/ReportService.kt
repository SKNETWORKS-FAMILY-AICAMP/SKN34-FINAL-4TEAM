package ai.storyfork.operations.report.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.has
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.report.entity.ReportEntity
import ai.storyfork.operations.report.entity.ReportHistoryEntity
import ai.storyfork.operations.report.entity.ReportHistoryType
import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.repository.ReportHistoryRepository
import ai.storyfork.operations.report.repository.ReportRepository
import ai.storyfork.operations.report.service.dto.*
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionOperations
import org.springframework.web.server.ResponseStatusException

private const val RIGHTS = "rights"

/**
 * Content is called before any local write, so a failure records neither state nor history. `create`, `restrict` and
 * `unrestrict` carry no `@Transactional`: even NOT_SUPPORTED keeps an EntityManager, and its connection, bound until return.
 */
@Service
class ReportService(
    private val reports: ReportRepository,
    private val histories: ReportHistoryRepository,
    private val permissions: AdminPermissionRepository,
    private val content: ContentClient,
    private val tx: TransactionOperations,
) {
    fun create(member: OperationsMember, request: ReportRequest): ReportResponse {
        text(request.reason, 2000)
        require(request.evidence.length <= 5000 && '\u0000' !in request.evidence) { "Invalid evidence." }
        val work = content.work(request.workId)
        // `report.work_owner_id` is a UUID but Content `owner_id` is a varchar: an owner that cannot be a member is refused before any write.
        val owner = try { UUID.fromString(work.ownerId) } catch (_: IllegalArgumentException) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "작품 소유자를 확인할 수 없어 신고할 수 없어요.")
        }
        return reports.saveAndFlush(ReportEntity(
            kind = request.kind, workId = work.workId, workTitle = work.title, workOwnerId = owner,
            reporterId = member.memberId, reason = request.reason, evidence = request.evidence,
        )).response()
    }

    @Transactional(readOnly = true)
    fun mine(member: OperationsMember) = ReportListResponse(
        reports.findTop200ByReporterIdOrWorkOwnerIdOrderByCreatedAtDescIdDesc(member.memberId, member.memberId).map { it.response() },
    )

    @Transactional(readOnly = true)
    fun list(member: OperationsMember, status: ReportStatus?): ReportListResponse {
        permissions.requirePermission(member, RIGHTS)
        val rows = if (status == null) reports.findTop200ByOrderByCreatedAtDescIdDesc() else reports.findTop200ByStatusOrderByCreatedAtDescIdDesc(status)
        return ReportListResponse(rows.map { it.response() })
    }

    @Transactional(readOnly = true)
    fun detail(member: OperationsMember, id: UUID): ReportResponse = viewable(member, id).detail()

    @Transactional(readOnly = true)
    fun explanations(member: OperationsMember, id: UUID): ReportHistoryListResponse {
        viewable(member, id)
        return ReportHistoryListResponse(
            histories.findAllByReportIdAndTypeOrderByCreatedAtAscIdAsc(id, ReportHistoryType.EXPLANATION).map { it.response() },
        )
    }

    @Transactional
    fun addEvidence(member: OperationsMember, id: UUID, request: ReportBodyRequest): ReportResponse {
        val row = report(id)
        if (row.reporterId != member.memberId) forbidden()
        return record(row, ReportHistoryType.EVIDENCE, member, text(request.body, 5000))
    }

    @Transactional
    fun addExplanation(member: OperationsMember, id: UUID, request: ReportBodyRequest): ReportResponse {
        val row = report(id)
        if (row.workOwnerId != member.memberId) forbidden()
        return record(row, ReportHistoryType.EXPLANATION, member, text(request.body, 5000))
    }

    @Transactional
    fun review(member: OperationsMember, id: UUID, request: ReportReviewRequest): ReportResponse {
        permissions.requirePermission(member, RIGHTS)
        require(request.decision != ReportStatus.RECEIVED) { "Decision must be ACCEPTED or REJECTED." }
        val note = text(request.note, 2000)
        val row = report(id)
        row.status = request.decision
        return record(row, ReportHistoryType.REVIEW, member, note)
    }

    fun restrict(member: OperationsMember, id: UUID): ReportResponse = restriction(member, id, true)

    fun unrestrict(member: OperationsMember, id: UUID): ReportResponse = restriction(member, id, false)

    @Transactional
    fun requestEvidence(member: OperationsMember, id: UUID, request: ReportBodyRequest): ReportResponse {
        permissions.requirePermission(member, RIGHTS)
        val body = text(request.body, 5000)
        return record(report(id), ReportHistoryType.EVIDENCE_REQUEST, member, body)
    }

    private fun restriction(member: OperationsMember, id: UUID, restricted: Boolean): ReportResponse {
        permissions.requirePermission(member, RIGHTS)
        val row = report(id)
        if (restricted) content.restrict(row.workId) else content.unrestrict(row.workId)
        row.contentRestricted = restricted
        // The row was read before the Content call, so `@Version` still turns a concurrent edit into a 409 here.
        return tx.execute { record(row, if (restricted) ReportHistoryType.RESTRICT else ReportHistoryType.UNRESTRICT, member, null) }
    }

    private fun record(row: ReportEntity, type: ReportHistoryType, member: OperationsMember, body: String?): ReportResponse {
        row.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val saved = reports.saveAndFlush(row)
        histories.saveAndFlush(ReportHistoryEntity(reportId = row.id, type = type, actorId = member.memberId, body = body))
        return saved.detail()
    }

    private fun viewable(member: OperationsMember, id: UUID): ReportEntity {
        val row = report(id)
        if (row.reporterId != member.memberId && row.workOwnerId != member.memberId && !permissions.has(member, RIGHTS)) forbidden()
        return row
    }

    private fun report(id: UUID): ReportEntity = reports.findById(id).orElseThrow { NoSuchElementException("Report not found.") }

    private fun forbidden(): Nothing = throw ResponseStatusException(HttpStatus.FORBIDDEN)

    private fun text(value: String, max: Int): String {
        require(value.isNotBlank() && value.length <= max && '\u0000' !in value) { "Invalid text." }
        return value
    }

    private fun ReportEntity.detail() = response(histories.findAllByReportIdOrderByCreatedAtAscIdAsc(id).map { it.response() })

    private fun ReportEntity.response(history: List<ReportHistoryResponse>? = null) = ReportResponse(
        id, kind, workId, workTitle, workOwnerId, reporterId, reason, evidence, status, contentRestricted, createdAt, updatedAt, history,
    )

    private fun ReportHistoryEntity.response() = ReportHistoryResponse(id, type, actorId, body, createdAt)
}
