package ai.storyfork.core.world.service.dto

import java.util.UUID

data class WorldDraftResponse(
    val worldId: UUID, val draftRevision: Long, val currentRevisionId: UUID?, val baseWorldRevisionId: UUID?,
    val name: String, val description: String, val cards: List<CardPayload>, val relationships: List<RelationshipPayload>
)
