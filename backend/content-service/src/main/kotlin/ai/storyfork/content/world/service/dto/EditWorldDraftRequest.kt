package ai.storyfork.content.world.service.dto

import com.fasterxml.jackson.annotation.JsonInclude
import java.util.UUID
import tools.jackson.core.JsonParser
import tools.jackson.core.JsonToken
import tools.jackson.databind.DeserializationContext
import tools.jackson.databind.ValueDeserializer
import tools.jackson.databind.annotation.JsonDeserialize

/**
 * [episode]는 [relationships]가 그 회차(연결된 소설의 회차 순번, 1 이상) 시점의 관계라는 뜻이며 생략하면 최신 회차다(DEC-51).
 * [relationshipEpisodes]는 관계 id → 그 관계의 'N화부터'다(DEC-54 2단계): 그 관계의 보낸 내용을 N화 연결로 쓰고, 없는 관계는 [episode]에 기록한다.
 * 값은 정수 JSON 값만 정수로 읽고 그 밖의 값은 거절한다([WholeEpisode]). 비어 있으면 직렬화하지 않아 이 필드가 생기기 전 요청과 요청 hash가 같다.
 */
data class EditWorldDraftRequest(
    val expectedDraftRevision: Long, val name: String, val description: String,
    val cards: List<CardPayload> = emptyList(), val relationships: List<RelationshipPayload> = emptyList(),
    val key: String = "", val replace: Boolean = false, val episode: Int? = null,
    @JsonInclude(JsonInclude.Include.NON_EMPTY) @JsonDeserialize(contentUsing = WholeEpisode::class) val relationshipEpisodes: Map<UUID, Int> = emptyMap()
)

/**
 * 관계별 회차 값을 정수 JSON 값(`3`)만 정수로 읽는다. Jackson 기본은 2.7→2, 3.0→3, "3"→3으로 조용히 바꾸므로 그 밖의 값(소수·문자열·불리언·배열·객체)은
 * 회차 검증([ai.storyfork.content.world.domain.validEpisode])이 거절하는 0으로 읽어 1 미만과 같이 422가 되게 한다.
 * null은 Kotlin 모듈이 비어 있을 수 없는 값으로 먼저 거절한다(본문 형식 오류 400). 요청 단위 `episode`는 기존 변환 그대로다.
 */
internal class WholeEpisode : ValueDeserializer<Int>() {
    override fun deserialize(p: JsonParser, ctxt: DeserializationContext): Int =
        if (p.currentToken() == JsonToken.VALUE_NUMBER_INT) p.intValue else { p.skipChildren(); 0 }
}
