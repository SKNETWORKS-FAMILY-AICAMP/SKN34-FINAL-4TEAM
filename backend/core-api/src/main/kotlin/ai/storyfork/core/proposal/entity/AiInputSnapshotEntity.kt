package ai.storyfork.core.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "ai_input_snapshot")
class AiInputSnapshotEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "job_id")
    var jobId: String = "",
    @field:Column(name = "episode_id")
    var episodeId: String? = null,
    @field:Column(name = "episode_version_id")
    var episodeVersionId: String? = null,
    @field:Column(name = "setting_version_id")
    var settingVersionId: String? = null,
    @field:Column(name = "source_kind")
    var sourceKind: String = "",
    @field:Column(name = "position")
    var position: String? = null,
    @field:Column(name = "content_snapshot")
    var contentSnapshot: String = "",
    @field:Column(name = "draft_revision")
    var draftRevision: Int? = null,
    @field:Column(name = "captured_at")
    var capturedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
