package ai.storyfork.operations.report.entity

import com.fasterxml.jackson.annotation.JsonValue
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

enum class ReportKind { RIGHTS, HARMFUL }
enum class ReportStatus { RECEIVED, ACCEPTED, REJECTED }
enum class ReportHistoryType { EVIDENCE, EXPLANATION, REVIEW, RESTRICT, UNRESTRICT, EVIDENCE_REQUEST }

/** What a report is about. JSON uses the lowercase [json] word; the database keeps the constant name like the other report enums. */
enum class ReportTarget(@get:JsonValue val json: String) { WORK("work"), EPISODE("episode"), WORLD("world") }

/**
 * Operations-owned report case; work title/owner are a snapshot taken from Content at intake. An episode report also keeps the episode number.
 * A world report has no work, title or owner: it keeps the world id and the world name instead (so nobody but the reporter and the admins sees it).
 */
@Entity
@Table(name = "report", schema = "operations")
class ReportEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Enumerated(EnumType.STRING)
    @field:Column(nullable = false, updatable = false, length = 20)
    val kind: ReportKind,
    @field:Enumerated(EnumType.STRING)
    @field:Column(name = "target_type", nullable = false, updatable = false, length = 20)
    val targetType: ReportTarget = ReportTarget.WORK,
    @field:Column(name = "work_id", updatable = false)
    val workId: UUID? = null,
    @field:Column(name = "episode_number", updatable = false)
    val episodeNumber: Int? = null,
    @field:Column(name = "work_title", updatable = false, columnDefinition = "text")
    val workTitle: String? = null,
    @field:Column(name = "work_owner_id", updatable = false)
    val workOwnerId: UUID? = null,
    @field:Column(name = "world_id", updatable = false)
    val worldId: UUID? = null,
    @field:Column(name = "world_name", updatable = false, columnDefinition = "text")
    val worldName: String? = null,
    @field:Column(name = "reporter_id", nullable = false, updatable = false)
    val reporterId: UUID,
    @field:Column(nullable = false, updatable = false, columnDefinition = "text")
    val reason: String,
    @field:Column(nullable = false, updatable = false, columnDefinition = "text")
    val evidence: String,
    @field:Enumerated(EnumType.STRING)
    @field:Column(nullable = false, length = 20)
    var status: ReportStatus = ReportStatus.RECEIVED,
    @field:Column(name = "content_restricted", nullable = false)
    var contentRestricted: Boolean = false,
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = createdAt,
    @field:Version
    @field:Column(nullable = false)
    var version: Long? = null,
)

/** Append-only action history, so it carries no version column. */
@Entity
@Table(name = "report_history", schema = "operations")
class ReportHistoryEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Column(name = "report_id", nullable = false, updatable = false)
    val reportId: UUID,
    @field:Enumerated(EnumType.STRING)
    @field:Column(nullable = false, updatable = false, length = 30)
    val type: ReportHistoryType,
    @field:Column(name = "actor_id", nullable = false, updatable = false)
    val actorId: UUID,
    @field:Column(updatable = false, columnDefinition = "text")
    val body: String?,
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
