package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "ai_evidence")
class AiEvidenceEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "episode_version_id")
    var episodeVersionId: String? = null,
    @field:Column(name = "setting_version_id")
    var settingVersionId: String? = null,
    @field:Column(name = "kind")
    var kind: String = "",
    @field:Column(name = "position")
    var position: String? = null,
    @field:Column(name = "excerpt_snapshot")
    var excerptSnapshot: String = "",
    @field:Column(name = "captured_at")
    var capturedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
