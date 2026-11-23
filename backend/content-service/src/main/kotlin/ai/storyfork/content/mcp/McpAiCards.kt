package ai.storyfork.content.mcp

import ai.storyfork.content.world.domain.aiCardType
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.PublicWorldResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import ai.storyfork.content.world.service.dto.WorldRevisionResponse

/**
 * AI가 아는 카드 유형은 기본 8종뿐이라 MCP로 나가는 카드의 운영 카테고리 코드는 `other`로 바꾼다([aiCardType], 운영 콘텐츠 관리 계약).
 * 카드를 싣는 도구 응답(초안·확정 버전·공개 세계관·독자 위키·이어받은 세계관)이 모두 거친다. 같은 응답을 쓰는 REST는 바꾸지 않는다.
 */
private fun CardPayload.forAi() = copy(cardType = aiCardType(cardType))

internal fun WorldDraftResponse.forAi() = copy(cards = cards.map { it.forAi() })
internal fun WorldRevisionResponse.forAi() = copy(cards = cards.map { it.copy(card = it.card.forAi()) })
internal fun InheritedWorldResponse.forAi() = copy(cards = cards.map { it.forAi() })
internal fun PublicWorldResponse.forAi() = copy(cards = cards.map { it.copy(cardType = aiCardType(it.cardType)) })
internal fun ReaderWorldCardsResponse.forAi() = copy(cards = cards.map { it.copy(cardType = aiCardType(it.cardType)) })
