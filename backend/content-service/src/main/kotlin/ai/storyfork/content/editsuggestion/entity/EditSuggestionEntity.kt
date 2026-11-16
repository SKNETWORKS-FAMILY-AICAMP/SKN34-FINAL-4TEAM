package ai.storyfork.content.editsuggestion.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 독자가 올린 문장 수정 제안이다. 등록 시점의 발행 버전 ID를 고정 저장하고, 제안자 표시명은 저장하지 않는다(응답마다 Core 닉네임 조회).
 * 원래 [afterText]는 보존하고 작가의 편집안은 [editedText]에 따로 둔다. 승인 내용은 `editedText ?: afterText`다.
 * 승인 뒤 초안 반영 결과는 상태와 따로 [applyResult]·[applyFailure]·[appliedVersionId]에 기록하고, [decidedAt]은 승인·거절한 시각이다.
 * [reportId]는 제보 연결(계약 3절)용 칸이라 아직 항상 null이다.
 */
@Entity
@Table(name = "edit_suggestion")
class EditSuggestionEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "episode_number")
    var episodeNumber: Int = 0,
    @field:Column(name = "published_version_id")
    var publishedVersionId: String = "",
    @field:Column(name = "proposer_id")
    var proposerId: String = "",
    @field:Column(name = "source")
    var source: String = "reader",
    @field:Column(name = "report_id")
    var reportId: String? = null,
    @field:Column(name = "before_text")
    var beforeText: String = "",
    @field:Column(name = "after_text")
    var afterText: String = "",
    @field:Column(name = "edited_text")
    var editedText: String? = null,
    @field:Column(name = "reason")
    var reason: String? = null,
    @field:Column(name = "status")
    var status: String = "pending",
    @field:Column(name = "decision_reason")
    var decisionReason: String? = null,
    @field:Column(name = "apply_result")
    var applyResult: String? = null,
    @field:Column(name = "apply_failure")
    var applyFailure: String? = null,
    @field:Column(name = "applied_version_id")
    var appliedVersionId: String? = null,
    @field:Column(name = "decided_at")
    var decidedAt: Instant? = null,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at")
    var updatedAt: Instant = createdAt,
)
