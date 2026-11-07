package ai.storyfork.operations.event.service.dto

import java.time.Instant
import java.util.UUID

data class EventResponse(
    val id: UUID,
    val title: String,
    val body: String,
    val startsAt: Instant?,
    val endsAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
)
