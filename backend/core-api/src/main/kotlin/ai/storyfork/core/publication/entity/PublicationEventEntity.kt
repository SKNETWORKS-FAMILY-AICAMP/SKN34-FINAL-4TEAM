package ai.storyfork.core.publication.entity

import jakarta.persistence.*
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name = "publication_event")
@Immutable
class PublicationEventEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "episode_version_id")
    var episodeVersionId: String = "",
    @field:Column(name = "actor_id")
    var actorId: String? = null,
    @field:Column(name = "action")
    var action: String = "",
    @field:Column(name = "outcome")
    var outcome: String = "",
    @field:Column(name = "occurred_at")
    var occurredAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "trigger_kind")
    var triggerKind: String = "",
)
