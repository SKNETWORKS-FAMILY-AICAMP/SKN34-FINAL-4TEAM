package ai.storyfork.content.world.service.dto

import com.fasterxml.jackson.annotation.JsonInclude
import java.util.UUID

/**
 * [episode]는 [relationships]가 그 회차(연결된 소설의 회차 순번, 1 이상) 시점의 관계라는 뜻이며 생략하면 최신 회차다(DEC-51).
 * [relationshipEpisodes]는 관계 id → 그 관계의 'N화부터'다(DEC-54 2단계): 그 관계의 보낸 내용을 N화 연결로 쓰고, 없는 관계는 [episode]에 기록한다.
 * 비어 있으면 직렬화하지 않아 이 필드가 생기기 전 요청과 요청 hash가 같다.
 */
data class EditWorldDraftRequest(
    val expectedDraftRevision: Long, val name: String, val description: String,
    val cards: List<CardPayload> = emptyList(), val relationships: List<RelationshipPayload> = emptyList(),
    val key: String = "", val replace: Boolean = false, val episode: Int? = null,
    @JsonInclude(JsonInclude.Include.NON_EMPTY) val relationshipEpisodes: Map<UUID, Int> = emptyMap()
)
