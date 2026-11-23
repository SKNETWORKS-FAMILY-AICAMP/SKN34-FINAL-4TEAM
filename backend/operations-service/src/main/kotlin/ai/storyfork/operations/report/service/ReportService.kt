package ai.storyfork.operations.report.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.has
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.report.entity.ReportEntity
import ai.storyfork.operations.report.entity.ReportHistoryEntity
import ai.storyfork.operations.report.entity.ReportHistoryType
import ai.storyfork.operations.report.entity.ReportStatus
import ai.storyfork.operations.report.entity.ReportTarget
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
import tools.jackson.databind.JsonNode

private const val RIGHTS = "rights"

/**
 * Content is called before any local write, so a failure records neither state nor history. `create`, `restrict` and
 * `unrestrict` carry no `@Transactional`: even NOT_SUPPORTED keeps an EntityManager, and its connection, bound until return.
 * The admin activity is saved in the same transaction as the report and history, after Content succeeded.
 */
@Service
class ReportService(
    private val reports: ReportRepository,
    private val histories: ReportHistoryRepository,
    private val permissions: AdminPermissionRepository,
    private val content: ContentClient,
    private val tx: TransactionOperations,
    private val activities: AdminActivityService,
) {
    fun create(member: OperationsMember, request: ReportRequest): ReportResponse {
        text(request.reason, 2000)
        require(request.evidence.length <= 5000 && '\u0000' !in request.evidence) { "Invalid evidence." }
        return reports.saveAndFlush(intake(member, request)).response()
    }

    /** What the report is about, read from Content before anything is stored: the ids the type asks for are checked first, and a target a reader cannot see (or Content does not list) is a 404. */
    private fun intake(member: OperationsMember, request: ReportRequest): ReportEntity {
        if (request.targetType == ReportTarget.WORLD) {
            val worldId = requireNotNull(request.worldId) { "worldId is required." }
            val world = content.worldStudios().values().firstOrNull { it.path("worldId").textOrNull() == worldId.toString() && it.isPublicWorld() }
                ?: throw NoSuchElementException("World not found.")
            return ReportEntity(
                kind = request.kind, targetType = ReportTarget.WORLD, worldId = worldId, worldName = world.path("name").textOrNull().orEmpty(),
                reporterId = member.memberId, reason = request.reason, evidence = request.evidence,
            )
        }
        val workId = requireNotNull(request.workId) { "workId is required." }
        val episode = if (request.targetType == ReportTarget.EPISODE) requireNotNull(request.episodeNumber) { "episodeNumber is required." } else null
        // ponytail: Content's single-work answer has no visibility, so the work is found in its whole operations list (one unpaged call, like the world list);
        // ask Content for a visibility on GET /internal/v1/works/{id} when that list outgrows one call. The same 404 for private, restricted and unknown works, with no title in it.
        val work = content.works().items.firstOrNull { it.workId == workId && it.visibility == "public" && !it.restricted }
            ?: throw NoSuchElementException("Work not found.")
        if (episode != null && content.episodes(workId).values().none { it.path("number").asInt(-1) == episode && it.isReadableEpisode() }) {
            throw NoSuchElementException("Episode not found.")
        }
        // `report.work_owner_id` is a UUID but Content `owner_id` is a varchar: an owner that cannot be a member is refused before any write.
        val owner = try { UUID.fromString(work.ownerId) } catch (_: IllegalArgumentException) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "작품 소유자를 확인할 수 없어 신고할 수 없어요.")
        }
        return ReportEntity(
            kind = request.kind, targetType = request.targetType, workId = work.workId, episodeNumber = episode, workTitle = work.title, workOwnerId = owner,
            reporterId = member.memberId, reason = request.reason, evidence = request.evidence,
        )
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
            .also { activities.record(member, "REPORT_REVIEW", "REPORT", id, request.decision.name) }
    }

    fun restrict(member: OperationsMember, id: UUID): ReportResponse = restriction(member, id, true)

    fun unrestrict(member: OperationsMember, id: UUID): ReportResponse = restriction(member, id, false)

    @Transactional
    fun requestEvidence(member: OperationsMember, id: UUID, request: ReportBodyRequest): ReportResponse {
        permissions.requirePermission(member, RIGHTS)
        val body = text(request.body, 5000)
        return record(report(id), ReportHistoryType.EVIDENCE_REQUEST, member, body)
            .also { activities.record(member, "REPORT_REQUEST_EVIDENCE", "REPORT", id, null) }
    }

    private fun restriction(member: OperationsMember, id: UUID, restricted: Boolean): ReportResponse {
        permissions.requirePermission(member, RIGHTS)
        val row = report(id)
        row.restrictAtContent(restricted)
        row.contentRestricted = restricted
        // The row was read before the Content call, so `@Version` still turns a concurrent edit into a 409 here.
        return tx.execute {
            record(row, if (restricted) ReportHistoryType.RESTRICT else ReportHistoryType.UNRESTRICT, member, null)
                .also { activities.record(member, if (restricted) "REPORT_RESTRICT" else "REPORT_UNRESTRICT", "REPORT", id, null) }
        }
    }

    /** The restriction goes to what the report is about: the work, one episode of it, or the world. Content's PUT and DELETE are idempotent. */
    private fun ReportEntity.restrictAtContent(restricted: Boolean) {
        when (targetType) {
            ReportTarget.WORK -> if (restricted) content.restrict(checkNotNull(workId)) else content.unrestrict(checkNotNull(workId))
            ReportTarget.EPISODE ->
                if (restricted) content.restrictEpisode(checkNotNull(workId), checkNotNull(episodeNumber))
                else content.unrestrictEpisode(checkNotNull(workId), checkNotNull(episodeNumber))
            ReportTarget.WORLD -> if (restricted) content.restrictWorld(checkNotNull(worldId)) else content.unrestrictWorld(checkNotNull(worldId))
        }
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
        id, kind, targetType, workId, workTitle, workOwnerId, episodeNumber, worldId, worldName, reporterId, reason, evidence, status, contentRestricted,
        createdAt, updatedAt, history,
    )

    private fun ReportHistoryEntity.response() = ReportHistoryResponse(id, type, actorId, body, createdAt)
}

/**
 * The operations world list also holds private, unsaved and restricted worlds. Only a world a reader can see (public, with a saved version, not restricted)
 * can be reported, so a private world's id and name are never confirmed to a reporter; a missing flag counts as not visible.
 */
private fun JsonNode.isPublicWorld() =
    path("visibility").textOrNull() == "public" && path("published").asBoolean(false) && !path("restricted").asBoolean(true)

/** A reader can open an episode only while it is published and not restricted; a draft, a suspended one or one without a state is not reportable. */
private fun JsonNode.isReadableEpisode() = path("publicationStatus").textOrNull() == "published" && !path("restricted").asBoolean(true)
