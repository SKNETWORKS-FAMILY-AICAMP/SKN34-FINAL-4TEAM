package ai.storyfork.content.world.service

import ai.storyfork.content.world.client.dto.WorldReviewAiCard
import ai.storyfork.content.world.client.dto.WorldReviewAiCharacterDocs
import ai.storyfork.content.world.client.dto.WorldReviewAiRelationship
import ai.storyfork.content.world.client.dto.WorldReviewAiRequest
import ai.storyfork.content.world.domain.stripCardLinks
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse

/**
 * 저장된 현재 초안(활성 카드와 최신 관계)에서 AI 검토 요청을 만든다(docs/design/world-review-contract.md).
 * 카드 본문·인물 문서의 본문 링크(`[글자](card:<uuid>)`, DEC-53)는 대상이 있든 없든 글자로 벗겨 보낸다(모델 입력에 id가 섞이지 않게 하고, 4,000자 한도도 벗긴 길이로 센다).
 * ponytail: 한 번에 [MAX_CARDS]장, 카드당 본문과 인물 문서 합계 [MAX_CARD_CHARS]자까지 보내고 넘는 카드는 뺀다. 긴 세계관의 분할 검토는 후속이다.
 */
object WorldReviewInput {
    const val MAX_CARDS = 300
    const val MAX_CARD_CHARS = 4000
    private val EPISODE_KEY = Regex("0|[1-9][0-9]*")

    fun fromDraft(draft: WorldDraftResponse): WorldReviewAiRequest {
        val cards = draft.cards.filter { it.lifecycle == "active" }.map(::aiCard).filter { it.chars() <= MAX_CARD_CHARS }.take(MAX_CARDS)
        val sent = cards.map { it.id }.toSet()
        // 시작·끝 카드를 모두 보낸 관계만 보낸다. 보내지 않은 카드를 가리키면 AI가 없는 설정을 짐작한다.
        val relationships = draft.relationships.filter { it.lifecycle == "active" }.mapNotNull { relation ->
            val source = relation.sourceCardId?.toString() ?: return@mapNotNull null
            val target = relation.targetCardId?.toString() ?: return@mapNotNull null
            if (source in sent && target in sent) WorldReviewAiRelationship(relation.id.toString(), source, target, relation.label, relation.polarity ?: "asserted") else null
        }
        return WorldReviewAiRequest(draft.name, draft.description, cards, relationships)
    }

    private fun aiCard(card: CardPayload) = WorldReviewAiCard(card.id.toString(), card.cardType, card.areaCode, card.title, stripCardLinks(card.body),
        if (card.cardType == "character") characterDocs(card.semanticMetadata) else null)

    /**
     * 카드 `semanticMetadata.characterDocs`(DEC-47)에서 SOUL·GOAL·회차 기억만 읽는다. 옛 `memory`는 보내지 않고(AI가 받으면 00회차 앞에 잇는 규칙으로 읽는다),
     * goal이 없으면 빈 글이다. 모양이 어긋나면 화면의 읽기 규칙처럼 문서 전체를 빼고 카드는 그대로 보낸다.
     */
    private fun characterDocs(metadata: Map<String, Any?>): WorldReviewAiCharacterDocs? {
        val docs = metadata["characterDocs"] as? Map<*, *> ?: return null
        val soul = docs["soul"] as? String ?: return null
        val goal = docs["goal"] ?: ""
        val episodes = docs["episodes"] as? Map<*, *> ?: return null
        if (goal !is String || episodes.any { (key, text) -> key !is String || !EPISODE_KEY.matches(key) || text !is String }) return null
        return WorldReviewAiCharacterDocs(stripCardLinks(soul), stripCardLinks(goal), episodes.entries.associate { (key, text) -> key as String to stripCardLinks(text as String) })
    }
}
