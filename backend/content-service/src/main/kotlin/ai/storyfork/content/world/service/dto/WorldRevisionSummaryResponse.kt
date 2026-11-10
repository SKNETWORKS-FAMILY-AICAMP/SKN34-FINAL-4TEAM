package ai.storyfork.content.world.service.dto

import java.util.UUID

data class WorldRevisionSummaryResponse(
    val worldId: UUID,
    val revisionId: UUID,
    val revisionNo: Long,
    val name: String,
    val createdAt: String,
)
