package ai.storyfork.content.world.service.dto


data class EditWorldDraftRequest(
    val expectedDraftRevision: Long, val name: String, val description: String,
    val cards: List<CardPayload> = emptyList(), val relationships: List<RelationshipPayload> = emptyList(),
    val key: String = "", val replace: Boolean = false
)
