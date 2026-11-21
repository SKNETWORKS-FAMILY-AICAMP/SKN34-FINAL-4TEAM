package ai.storyfork.content.work.service.dto

/**
 * 운영 퍼널 지표(DEC-57)다. 전체 기간의 수만 담고 비율·오차는 화면이 계산한다. 회원 수는 서로 다른 회원 ID이며 칸마다 세는 곳은
 * 계약([operations-funnel-credit-contract](docs/design/operations-funnel-credit-contract.md)) 1번 절의 '세는 곳' 표다.
 * [proposals]·[feedback]은 운영 통계(DEC-55)와 같은 정의의 전체 기간 값이다.
 */
data class OperationsFunnelResponse(
    val readers: FunnelReaders,
    val reactions: FunnelReactions,
    val forks: FunnelForks,
    val writers: FunnelWriters,
    val proposals: ProposalDecisionStats,
    val feedback: EditSuggestionStats,
)

/** 독자 단계: 공개 회차 조회 기록이 있는 회원([viewed], 작품 상세 전용 조회 기록은 없다), 회차를 하나 이상 읽은 회원([readAny]), 같은 작품에서 회차를 둘 이상 읽은 회원([readNext])이다. */
data class FunnelReaders(val viewed: Long, val readAny: Long, val readNext: Long)

/** 반응: 각 작품이 직접 발행한 현재 발행 회차 수(Fork가 물려받은 원작 회차는 뺀다)와 좋아요·관심·댓글 수다(삭제된 작품과 삭제·숨김 댓글은 뺀다). */
data class FunnelReactions(val publishedEpisodes: Long, val likes: Long, val interests: Long, val comments: Long)

/** 독자→Fork: [readers]는 [FunnelReaders.readAny]와 같은 집단, [readerForked]는 그중 Fork를 만든 회원, [baseEpisodes]는 Fork 기준 회차 분포다. */
data class FunnelForks(val readers: Long, val readerForked: Long, val baseEpisodes: List<BaseEpisodeBucket>)

/** Fork 기준 회차 구간(`1`·`2`·`3`·`4-5`·`6-10`·`11+`, 이 순서로 늘 여섯 개)과 그 구간의 Fork 수다. */
data class BaseEpisodeBucket(val bucket: String, val count: Long)

/**
 * Fork 작가 단계: [forks]는 Fork 작품 수, [saved]는 그중 작가가 직접 저장한 원고 버전이 있는 수, [published]는 직접 발행한 회차가 있는 수,
 * [medianHoursToPublish]는 Fork 생성부터 첫 직접 발행까지 시간(시간 단위, 소수 1자리)의 중앙값이다(발행한 Fork가 없으면 null).
 */
data class FunnelWriters(val forks: Long, val saved: Long, val published: Long, val medianHoursToPublish: Double?)
