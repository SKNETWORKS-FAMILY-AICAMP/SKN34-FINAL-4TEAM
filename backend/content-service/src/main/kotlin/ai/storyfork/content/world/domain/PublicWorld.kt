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

/** 보이는 관계는 양 끝이 모두 보이는 카드([shownCardEpisode])인 것뿐이다. 끝이 비었거나 저장 버전에 없는 카드·기준 회차 뒤나 작가 전용 카드를 가리키는 관계는 뺀다. */
fun visibleRelationships(rows: List<RelationshipPayload>, cardIds: Set<UUID>): List<RelationshipPayload> =
    rows.filter { it.sourceCardId in cardIds && it.targetCardId in cardIds }

/**
 * 설정 카드의 공개 회차('N화부터', DEC-46)다. 카드 `semanticMetadata`의 최상위 `revealFromEpisode`가 1 이상의 정수인 JSON 숫자일 때만 읽는다.
 * 값이 없거나(JSON null 포함) 문자열·소수·0·음수·int 범위 밖이면 null이다(닫힌 쪽으로 실패). 옛 공개 카드의 1화 규칙은 [shownCardEpisode]가 더한다. jsonb 숫자는 Int·Long 등 어느 타입으로도 올 수 있어 값으로 판정한다.
 */
fun revealFromEpisode(metadata: Map<String, Any?>): Int? {
    val number = (metadata["revealFromEpisode"] as? Number)?.toDouble() ?: return null
    return number.takeIf { it >= 1 && it <= Int.MAX_VALUE && it == Math.floor(it) }?.toInt()
}

/**
 * 설정 카드의 대표 이미지 ID(#401)다. 카드 `semanticMetadata`의 최상위 `imageId`가 UUID 문자열일 때만 읽고, 없거나 null이거나 UUID가 아니면 null이다(이미지 없음으로 닫힌 쪽으로 실패).
 * `UUID.fromString`은 `1-1-1-1-1` 같은 축약형도 받아 주므로 표준 36자 형식(대소문자 무관)만 인정한다.
 */
fun cardImageId(metadata: Map<String, Any?>): UUID? {
    val text = metadata["imageId"] as? String ?: return null
    return try { UUID.fromString(text).takeIf { it.toString() == text.lowercase() } } catch (_: IllegalArgumentException) { null }
}

/**
 * 비작가(독자·공개 세계관·가져오기·Fork)에게 기준 회차 [basis]화에 보이는 카드면 그 유효 공개 회차를, 아니면 null(작가 전용)을 돌려준다(DEC-53). 모든 비작가 출구가 이 함수 하나를 쓴다.
 * 유효 공개 회차는 `revealFromEpisode` 키가 있으면 그 값이고, 키가 없고 `visibility`가 public이면 1(옛 공개 카드는 읽을 때 계산한다, 저장은 다시 쓰지 않는다), 그 밖은 작가 전용이다.
 * 키가 있는데 읽을 수 없으면(JSON null·문자열·소수·0·음수 등, [revealFromEpisode]가 null) 공개 1화로 되돌리지 않고 작가 전용으로 닫는다. 보이려면 삭제되지 않았고 유효 공개 회차가 [basis] 이하여야 한다.
 */
fun shownCardEpisode(lifecycle: String, visibility: String, metadata: Map<String, Any?>, basis: Int): Int? =
    (if ("revealFromEpisode" in metadata) revealFromEpisode(metadata) else 1.takeIf { visibility == "public" })
        ?.takeIf { lifecycle == "active" && it <= basis }

/** 독자 설정 위키의 `upto` 쿼리(기준 회차, 1 이상의 정수)다. 없으면 null(마지막 발행 회차 기준)이고 값 오류는 422다. */
fun readerUpto(code: String?): Int? = code?.let { queryInt(it, 1, 1..Int.MAX_VALUE, "upto") }

/**
 * 쿼리 page(0부터)·size(한 페이지의 세계관 수)를 목록 구간으로 읽는다. 없으면 page 0·size 24이고, 숫자가 아닌 값·범위 밖 page(음수이거나 너무 큼)·
 * 1~100 밖 size는 422다(숫자 타입으로 받으면 Spring 변환 실패가 400이라 문자열로 받아 여기서 읽는다).
 */
fun publicWorldPage(page: String?, size: String?): PageRequest =
    PageRequest.of(queryInt(page, 0, 0..MAX_PAGE, "page"), queryInt(size, DEFAULT_PAGE_SIZE, 1..MAX_PAGE_SIZE, "size"))

private fun queryInt(code: String?, default: Int, range: IntRange, name: String): Int =
    if (code == null) default
    else code.toIntOrNull()?.takeIf { it in range } ?: throw ContentFailure(422, "$name 값을 확인해 주세요.")
