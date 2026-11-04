package ai.storyfork.content.world.service.dto

import java.util.UUID

data class RestoreWorldRequest(
    val expectedDraftRevision: Long, val key: String, val revisionId: UUID
)
