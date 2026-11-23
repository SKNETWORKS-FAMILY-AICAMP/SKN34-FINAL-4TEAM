package ai.storyfork.content.world

import ai.storyfork.content.world.domain.DEFAULT_CARD_TYPES
import ai.storyfork.content.world.studio.entity.CardCategory

/** WorldStudio V18 시드와 같은 기본 8종 카드 카테고리다. 카드 유형 검사를 거치는 WorldStudioService 단위 테스트가 저장소 대역에 채운다. */
fun defaultCardCategories(): List<CardCategory> = DEFAULT_CARD_TYPES.mapIndexed { index, code -> CardCategory(code, code, null, true, index + 1) }
