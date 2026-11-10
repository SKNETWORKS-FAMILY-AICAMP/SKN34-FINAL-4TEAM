package ai.storyfork.operations.activity.service.dto

import java.time.Instant
import java.util.UUID

/** [actorNickname] is the current Core nickname, or null when the actor is no longer a Core admin (the screen then shows [actorId]). */
data class AdminActivityResponse(
    val id: UUID,
    val actorId: UUID,
    val actorNickname: String?,
    val action: String,
    val targetType: String,
    val targetId: String,
    val detail: String?,
    val createdAt: Instant,
)

data class AdminActivityListResponse(val items: List<AdminActivityResponse>)
