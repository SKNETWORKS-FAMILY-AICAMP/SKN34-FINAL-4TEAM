package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.ContentFailure
import java.time.Duration
import java.time.Instant

/** 기간별 랭킹 종류(kind, 기능표 45). 종류별 점수·제외·동점은 [periodRankingIds]가 정한다. */
enum class RankKind { VIEW, RISING, POPULAR, LATEST, UPDATED }

/** 랭킹 기간(period). 요청 시각 기준 롤링 구간이며 [length]가 구간 길이다. LATEST·UPDATED는 기간을 정렬에 쓰지 않는다. */
enum class RankPeriod(val length: Duration) { DAY(Duration.ofHours(24)), WEEK(Duration.ofDays(7)), MONTH(Duration.ofDays(30)) }

/** 랭킹 대상 범위(type). ORIGINAL은 Fork가 아닌 원작, FORK는 Fork 작품이다. */
enum class RankType { ALL, ORIGINAL, FORK }

private const val DEFAULT_RANK_LIMIT = 10
private const val MAX_RANK_LIMIT = 50

/** limit 쿼리 값이다. 없으면 10이고, 1~50이 아니거나 숫자가 아니면 422다. */
fun rankLimit(raw: String?): Int =
    if (raw == null) DEFAULT_RANK_LIMIT
    else raw.toIntOrNull()?.takeIf { it in 1..MAX_RANK_LIMIT } ?: throw ContentFailure(422, "limit 값을 확인해 주세요.")

/** type 범위에 드는 작품인지다. [fork]는 작품이 Fork(원작 출처가 있음)인지다. */
fun matchesType(type: RankType, fork: Boolean): Boolean = when (type) {
    RankType.ALL -> true
    RankType.ORIGINAL -> !fork
    RankType.FORK -> fork
}

/**
 * 종류별 점수가 큰 순서로 정렬한 작품 id 전체다(자르지 않는다). 호출부가 공개 여부·type으로 거른 뒤 limit을 적용한다.
 * [newestFirst]는 작품 생성 최신순이며 모든 종류의 동점을 이 순서로 정한다.
 * - VIEW: 기간 조회 수(0 제외). RISING: 기간 조회 수 − 바로 앞 같은 길이 기간 조회 수(0 이하 제외). 둘 다 [views]를 쓴다.
 * - POPULAR: 기간 안 새 좋아요 수 [likes](0 제외), 동점은 기간 조회 수 → 생성 최신순.
 * - LATEST: 생성 최신순 그대로(제외 없음). UPDATED: 마지막 발행 시각 [published] 큰 순(발행 기록 없는 작품 제외).
 */
fun periodRankingIds(kind: RankKind, newestFirst: List<String>, views: Map<String, WorkViews>, likes: Map<String, Long>, published: Map<String, Instant>): List<String> = when (kind) {
    RankKind.VIEW -> rankingIds(RankingKind.TOP, newestFirst, views, Int.MAX_VALUE)
    RankKind.RISING -> rankingIds(RankingKind.RISING, newestFirst, views, Int.MAX_VALUE)
    RankKind.POPULAR -> newestFirst.filter { (likes[it] ?: 0L) > 0 }
        .sortedWith(compareByDescending<String> { likes.getValue(it) }.thenByDescending { views[it]?.recent ?: 0L })
    RankKind.LATEST -> newestFirst
    RankKind.UPDATED -> newestFirst.filter { it in published }.sortedByDescending { published.getValue(it) }
}
