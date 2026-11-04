package ai.storyfork.content.world.service.dto


data class SaveWorldRequest(
    val expectedDraftRevision: Long, val key: String
)
