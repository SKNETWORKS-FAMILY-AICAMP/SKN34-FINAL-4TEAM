package ai.storyfork.content.world.domain

/**
 * 기본 카드 유형(카테고리) 8종이다(WorldStudio V18 시드, 화면의 순서). AI가 아는 카드 유형은 이 코드뿐이라
 * Content가 AI로 보낼 때 이 밖의 코드는 [aiCardType]으로 `other`로 바꾼다.
 */
val DEFAULT_CARD_TYPES = listOf("character", "location", "organization", "ability", "object", "rule", "event", "other")

/** AI가 받는 카드 유형이다: 기본 8종은 그대로, 운영이 더한 카테고리는 `other`다. AI 결과는 기본 8종 그대로 저장하므로 되돌려 바꾸지 않는다. */
fun aiCardType(type: String): String = if (type in DEFAULT_CARD_TYPES) type else "other"
