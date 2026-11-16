package ai.storyfork.content.world.service.dto

import com.fasterxml.jackson.annotation.JsonInclude

/** 설정집 AI 검토 요청. `consent`가 true여야 설정집을 OpenAI로 보낸다(없거나 true가 아니면 422 `AI_CONSENT_REQUIRED`). */
data class WorldReviewRequest(val consent: Boolean? = null)

/** [reviewedCards]는 AI에 보낸 카드 수, [totalCards]는 활성 카드 수다. 한도를 넘어 보내지 않은 카드가 있으면 [reviewedCards]가 더 작다. 아무것도 저장하지 않는다. */
data class WorldReviewResponse(val draftRevision: Long, val reviewedCards: Int, val totalCards: Int, val findings: List<WorldReviewFinding>, val model: String)

/** AI가 낸 지적 하나: 관련 카드 1~3장과 문장. 수정안([fix])은 선택이며 없으면 JSON에도 나가지 않는다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class WorldReviewFinding(val cardIds: List<String>, val kind: String, val message: String, val fix: WorldReviewFix? = null)

/** 카드 하나의 한 칸(`body|soul|goal|episode`)을 바꿀 새 글 전체다. [episode]는 target이 `episode`일 때만 있다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class WorldReviewFix(val cardId: String, val target: String, val episode: Int? = null, val text: String)
