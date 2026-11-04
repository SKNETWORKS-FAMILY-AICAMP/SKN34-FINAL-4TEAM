package ai.storyfork.content.world.service.dto

import java.util.UUID

data class CardPayload(
    val id: UUID, val title: String, val body: String, val cardType: String, val areaCode: String,
    val classification: String = "", val aliases: List<String> = emptyList(), val tags: List<String> = emptyList(),
    val semanticMetadata: Map<String, Any?> = emptyMap(), val visibility: String = "private", val lifecycle: String = "active"
)
