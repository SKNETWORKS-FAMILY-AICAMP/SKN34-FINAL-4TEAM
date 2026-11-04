package ai.storyfork.core.world.entity

import jakarta.persistence.*
import java.util.UUID

@Embeddable
data class RevisionRelationshipKey(
    @Column(name="revision_id") var revisionId: UUID = UUID(0,0),
    @Column(name="relation_id") var relationId: UUID = UUID(0,0),
) : java.io.Serializable
