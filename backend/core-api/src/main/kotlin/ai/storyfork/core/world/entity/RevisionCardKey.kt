package ai.storyfork.core.world.entity

import jakarta.persistence.*
import java.util.UUID

@Embeddable
data class RevisionCardKey(
    @Column(name="revision_id") var revisionId: UUID = UUID(0,0),
    @Column(name="card_id") var cardId: UUID = UUID(0,0),
) : java.io.Serializable
