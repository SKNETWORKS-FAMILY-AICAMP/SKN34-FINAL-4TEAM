package ai.storyfork.content.world.service.dto

import ai.storyfork.content.world.client.dto.WorldReviewAiCharacterDocs
import com.fasterxml.jackson.annotation.JsonInclude

/** 설정집 AI 검토 요청. `consent`가 true여야 설정집을 OpenAI로 보낸다(없거나 true가 아니면 422 `AI_CONSENT_REQUIRED`). */
data class WorldReviewRequest(val consent: Boolean? = null)

/**
 * [reviewedCards]는 AI에 보낸 카드 수, [totalCards]는 활성 카드 수다. 한도를 넘어 보내지 않은 카드가 있으면 [reviewedCards]가 더 작다.
 * [reviewedAt]은 검토를 마친 시각(ISO-8601, UTC)이고 [basis]는 수정안([WorldReviewFix])이 가리킨 카드 id → 검토에 쓴 초안의 그 카드 글이다.
 * 마지막 검토 하나가 세계관마다 저장되어(`worldstudio.world_review_result`) `GET …/reviews/latest`가 같은 모양으로 돌려준다.
 */
data class WorldReviewResponse(
    val draftRevision: Long, val reviewedCards: Int, val totalCards: Int, val findings: List<WorldReviewFinding>, val model: String,
    val reviewedAt: String, val basis: Map<String, WorldReviewBasis>
)

/**
 * 수정안이 가리킨 카드의 검토 시점 글이다. 본문 링크를 벗기기 전 원문이라 화면이 저장본과 그대로 비교한다.
 * [characterDocs]는 문서 모양이 맞는 인물 카드에만 있고 없으면 JSON에도 나가지 않는다(AI 요청의 인물 문서와 같은 모양이다).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class WorldReviewBasis(val body: String, val characterDocs: WorldReviewAiCharacterDocs? = null)

/** AI가 낸 지적 하나: 관련 카드 1~3장과 문장. 수정안([fix])은 선택이며 없으면 JSON에도 나가지 않는다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class WorldReviewFinding(val cardIds: List<String>, val kind: String, val message: String, val fix: WorldReviewFix? = null)

/** 카드 하나의 한 칸(`body|soul|goal|episode`)을 바꿀 새 글 전체다. [episode]는 target이 `episode`일 때만 있다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class WorldReviewFix(val cardId: String, val target: String, val episode: Int? = null, val text: String)
