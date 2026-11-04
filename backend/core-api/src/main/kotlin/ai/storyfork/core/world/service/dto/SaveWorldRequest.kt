package ai.storyfork.core.world.service.dto


data class SaveWorldRequest(
    val expectedDraftRevision: Long, val key: String
)
