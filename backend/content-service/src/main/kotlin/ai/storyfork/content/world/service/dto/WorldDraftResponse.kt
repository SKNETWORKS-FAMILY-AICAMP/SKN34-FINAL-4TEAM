package ai.storyfork.content.world.service.dto

import java.util.UUID

data class WorldDraftResponse(
    val worldId: UUID, val draftRevision: Long, val currentRevisionId: UUID?, val baseWorldRevisionId: UUID?,
    val name: String, val description: String, val cards: List<CardPayload>, val relationships: List<RelationshipPayload>,
    val relationshipVersion: Long = 0, val relationshipStatus: String = "current",
    val visibility: String = "private", val genre: String? = null, val hasCover: Boolean = false,
    /** 이 세계관에 연결된 소설(1:1, DEC-46). 소유자 HTTP 응답에서만 채우고 연결이 없으면 null이다. */
    val linkedWorkId: String? = null
)
