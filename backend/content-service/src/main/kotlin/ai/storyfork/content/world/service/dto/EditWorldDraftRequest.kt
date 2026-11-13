package ai.storyfork.content.world.service.dto


/** [episode]는 [relationships]가 그 회차(연결된 소설의 회차 순번, 1 이상) 시점의 관계라는 뜻이며 생략하면 최신 회차다(DEC-51). */
data class EditWorldDraftRequest(
    val expectedDraftRevision: Long, val name: String, val description: String,
    val cards: List<CardPayload> = emptyList(), val relationships: List<RelationshipPayload> = emptyList(),
    val key: String = "", val replace: Boolean = false, val episode: Int? = null
)
