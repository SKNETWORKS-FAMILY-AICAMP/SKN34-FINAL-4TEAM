package ai.storyfork.content.world.client.dto

import com.fasterxml.jackson.annotation.JsonInclude

/** AI `POST /internal/v1/world-reviews`의 요청 본문이다(docs/design/world-review-contract.md). 초안에서 만드는 규칙은 `WorldReviewInput`이 갖는다. */
data class WorldReviewAiRequest(
    val worldName: String, val worldDescription: String, val cards: List<WorldReviewAiCard>, val relationships: List<WorldReviewAiRelationship>
)

/** [characterDocs]는 인물 카드에만 있고 없으면 JSON에도 나가지 않는다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class WorldReviewAiCard(
    val id: String, val cardType: String, val areaCode: String, val title: String, val body: String, val characterDocs: WorldReviewAiCharacterDocs? = null
) {
    /** 보내는 글자 수: 본문과 인물 문서의 합계(제목 제외). */
    fun chars() = body.length + (characterDocs?.run { soul.length + goal.length + episodes.values.sumOf { it.length } } ?: 0)
}

data class WorldReviewAiCharacterDocs(val soul: String, val goal: String, val episodes: Map<String, String>)

data class WorldReviewAiRelationship(val id: String, val sourceCardId: String, val targetCardId: String, val label: String, val polarity: String)
