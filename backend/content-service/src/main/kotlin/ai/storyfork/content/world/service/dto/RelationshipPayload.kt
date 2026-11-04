package ai.storyfork.content.world.service.dto

import java.util.UUID

data class RelationshipPayload(
    val id: UUID, val sourceCardId: UUID?, val targetCardId: UUID?, val category: String?, val body: String = "",
    val label: String = "", val direction: String? = null, val polarity: String? = null,
    val semanticMetadata: Map<String, Any?> = emptyMap(), val lifecycle: String = "active"
)
