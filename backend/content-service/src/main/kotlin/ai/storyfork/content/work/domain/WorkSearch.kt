package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.ContentFailure
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** 공개 작품 검색 대상(f). */
enum class SearchField { ALL, TITLE, AUTHOR, TAG, GENRE }

/** 공개 작품 목록 정렬(sort). LATEST는 기존 순서인 작품 생성 최신순, LIKE는 공개 좋아요 수, VIEW는 최근 24시간 조회 수 내림차순이다. */
enum class WorkSort { LATEST, LIKE, VIEW }

/** 랭킹 종류(kind). TOP은 최근 24시간 조회 수, RISING은 그 전 24시간 대비 증가분이다. */
enum class RankingKind { TOP, RISING }

/** 작품의 최근 24시간(recent)과 그 전 24시간(prior) 조회 수. */
data class WorkViews(val recent: Long, val prior: Long)

private const val RANKING_SIZE = 10
private const val DEFAULT_PAGE_SIZE = 20
private const val MAX_PAGE_SIZE = 100

/** 목록 구간이다. [page]는 0부터, [size]는 한 페이지의 작품 수다. */
data class WorkPage(val page: Int, val size: Int)

/** 조회 기록의 "하루"는 서울 날짜다(회원·회차별 하루 1회 규칙). */
fun viewDate(now: Instant): LocalDate = now.atZone(ZoneId.of("Asia/Seoul")).toLocalDate()

/** 쿼리 값(소문자 이름)을 enum으로 바꾼다. 값이 없으면 [default], 모르는 값은 422다. */
inline fun <reified E : Enum<E>> queryOption(code: String?, default: E, name: String): E =
    if (code == null) default
    else enumValues<E>().firstOrNull { it.name.lowercase() == code } ?: throw ContentFailure(422, "$name 값을 확인해 주세요.")

/** 쿼리 값을 [range] 안의 정수로 바꾼다. 값이 없으면 [default], 숫자가 아니거나 범위 밖이면 422다. */
private fun queryInt(code: String?, default: Int, range: IntRange, name: String): Int =
    if (code == null) default
    else code.toIntOrNull()?.takeIf { it in range } ?: throw ContentFailure(422, "$name 값을 확인해 주세요.")

/**
 * 쿼리 page·size를 검사한다. 둘 다 없으면 null(전체)이고, 하나만 오면 없는 쪽은 page 0·size 20이다.
 * 숫자가 아닌 값·음수 page·1~100 밖 size는 422다(숫자 타입으로 받으면 Spring 변환 실패가 400이라 문자열로 받아 여기서 읽는다).
 */
fun workPage(page: String?, size: String?): WorkPage? =
    if (page == null && size == null) null
    else WorkPage(queryInt(page, 0, 0..Int.MAX_VALUE, "page"), queryInt(size, DEFAULT_PAGE_SIZE, 1..MAX_PAGE_SIZE, "size"))

/**
 * 정렬을 마친 [items]에서 [window] 구간만 돌려준다. [window]가 null이면 전체이고 범위 밖 page는 빈 목록이다.
 * ponytail: 전체를 메모리에서 정렬한 뒤 자른다(시연 규모). 작품이 늘면 SQL LIMIT/OFFSET과 개수 응답으로 옮긴다.
 */
fun <T> pageOf(items: List<T>, window: WorkPage?): List<T> =
    if (window == null) items else items.chunked(window.size).getOrElse(window.page) { emptyList() }

/**
 * 제목·작가명·해시태그·장르(본문 제외)에서 대소문자 무시 부분 일치를 찾는다. 검색어는 앞뒤 공백을 자르며 비어 있으면 모두 일치한다.
 * 해시태그는 검색어와 저장값 모두 앞 `#`을 무시한다.
 */
fun matchesSearch(title: String, author: String, genres: List<String>, hashtags: List<String>, query: String?, field: SearchField): Boolean {
    val q = query?.trim().orEmpty()
    if (q.isEmpty()) return true
    val tag = q.trimStart('#')
    val byTitle = title.contains(q, ignoreCase = true)
    val byAuthor = author.contains(q, ignoreCase = true)
    val byTag = hashtags.any { it.trimStart('#').contains(tag, ignoreCase = true) }
    val byGenre = genres.any { it.contains(q, ignoreCase = true) }
    return when (field) {
        SearchField.TITLE -> byTitle
        SearchField.AUTHOR -> byAuthor
        SearchField.TAG -> byTag
        SearchField.GENRE -> byGenre
        SearchField.ALL -> byTitle || byAuthor || byTag || byGenre
    }
}

private fun score(kind: RankingKind, views: WorkViews?): Long = when (kind) {
    RankingKind.TOP -> views?.recent ?: 0L
    RankingKind.RISING -> (views?.recent ?: 0L) - (views?.prior ?: 0L)
}

/**
 * 점수(TOP: 최근 24시간 조회 수, RISING: 그 전 24시간 대비 증가분)가 0 이하인 작품을 빼고 큰 순서로 최대 10개의 id를 돌려준다.
 * 동점은 [newestFirst] 순서(작품 생성 최신순)를 유지한다.
 */
fun rankingIds(kind: RankingKind, newestFirst: List<String>, counts: Map<String, WorkViews>): List<String> =
    newestFirst.filter { score(kind, counts[it]) > 0 }.sortedByDescending { score(kind, counts[it]) }.take(RANKING_SIZE)

/** 최근 24시간 조회 수 내림차순 id 목록이다. 조회가 없는 작품도 남기며 동점은 [newestFirst] 순서(작품 생성 최신순)를 유지한다. */
fun orderByViews(newestFirst: List<String>, counts: Map<String, WorkViews>): List<String> =
    newestFirst.sortedByDescending { counts[it]?.recent ?: 0L }

/** 공개 좋아요 수 내림차순 id 목록이다. 좋아요가 없는 작품도 남기며 동점은 [newestFirst] 순서(작품 생성 최신순)를 유지한다. */
fun orderByLikes(newestFirst: List<String>, likes: Map<String, Long>): List<String> =
    newestFirst.sortedByDescending { likes[it] ?: 0L }
