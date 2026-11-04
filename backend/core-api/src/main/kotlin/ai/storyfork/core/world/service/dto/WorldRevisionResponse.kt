package ai.storyfork.core.world.service.dto

import java.util.UUID

data class WorldRevisionResponse(
    val worldId: UUID, val revisionId: UUID, val revisionNo: Long, val name: String, val description: String,
    val parentRevisionId: UUID?, val restoredFromRevisionId: UUID?,
    val cards: List<SavedCardResponse>, val relationships: List<SavedRelationshipResponse>
)
