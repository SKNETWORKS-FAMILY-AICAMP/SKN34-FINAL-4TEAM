package ai.storyfork.content.world.domain

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID
import org.springframework.data.domain.PageRequest

/** 세계관 장르 코드다. 소유자가 공개할 때 고르고(미지정은 null) 공개 목록의 필터가 된다. */
val WORLD_GENRES = listOf("fantasy", "sf", "wuxia", "romance", "modern", "classic", "mystery")

private val WORLD_VISIBILITIES = setOf("private", "public")
private const val DEFAULT_PAGE_SIZE = 24
private const val MAX_PAGE_SIZE = 100
// 가장 큰 page와 size의 오프셋이 쿼리의 int 오프셋을 넘지 않게 한다.
private const val MAX_PAGE = Int.MAX_VALUE / MAX_PAGE_SIZE

/** 공개 범위 코드를 정확히 검사한다. 값 오류는 [IllegalArgumentException]이며 소유자 API가 422로 바꾼다. */
fun worldVisibility(code: String?): String = requireNotNull(code?.takeIf { it in WORLD_VISIBILITIES }) { "세계관 공개 범위를 확인하세요." }

/** 장르 코드는 선택이지만 있으면 [WORLD_GENRES]의 정확한 값이어야 한다. 값 오류는 [IllegalArgumentException]이다. */
fun worldGenre(code: String?): String? = code?.also { require(it in WORLD_GENRES) { "세계관 장르를 확인하세요." } }

/** 공개 목록·상세에 나오는지다. 공개로 설정돼도 저장 버전이 하나도 없으면(초안만 있으면) 나오지 않는다. */
fun isListed(visibility: String, currentRevisionId: UUID?): Boolean = visibility == "public" && currentRevisionId != null

/** 공개 관계는 양 끝이 모두 공개 카드인 것뿐이다. 끝이 비었거나 저장 버전에 없는 카드를 가리키는 관계는 뺀다. */
fun visibleRelationships(rows: List<RelationshipPayload>, cardIds: Set<UUID>): List<RelationshipPayload> =
    rows.filter { it.sourceCardId in cardIds && it.targetCardId in cardIds }

/**
 * 쿼리 page(0부터)·size(한 페이지의 세계관 수)를 목록 구간으로 읽는다. 없으면 page 0·size 24이고, 숫자가 아닌 값·범위 밖 page(음수이거나 너무 큼)·
 * 1~100 밖 size는 422다(숫자 타입으로 받으면 Spring 변환 실패가 400이라 문자열로 받아 여기서 읽는다).
 */
fun publicWorldPage(page: String?, size: String?): PageRequest =
    PageRequest.of(queryInt(page, 0, 0..MAX_PAGE, "page"), queryInt(size, DEFAULT_PAGE_SIZE, 1..MAX_PAGE_SIZE, "size"))

private fun queryInt(code: String?, default: Int, range: IntRange, name: String): Int =
    if (code == null) default
    else code.toIntOrNull()?.takeIf { it in range } ?: throw ContentFailure(422, "$name 값을 확인해 주세요.")
