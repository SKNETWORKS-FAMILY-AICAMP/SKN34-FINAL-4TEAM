package ai.storyfork.content.work.service

import ai.storyfork.content.comment.repository.EpisodeCommentRepository
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.interest.repository.WorkInterestRepository
import ai.storyfork.content.like.repository.WorkLikeRepository
import ai.storyfork.content.reading.repository.ReadingEpisodeRepository
import ai.storyfork.content.work.repository.WorkViewRepository
import ai.storyfork.content.work.service.dto.BaseEpisodeBucket
import ai.storyfork.content.work.service.dto.FunnelForks
import ai.storyfork.content.work.service.dto.FunnelReactions
import ai.storyfork.content.work.service.dto.FunnelReaders
import ai.storyfork.content.work.service.dto.FunnelWriters
import ai.storyfork.content.work.service.dto.OperationsFunnelResponse
import java.time.Duration
import java.time.Instant
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** Fork 기준 회차 구간이다. 라벨과 포함 범위가 계약의 고정 순서(1·2·3·4-5·6-10·11+)이며 Fork가 없는 구간도 0으로 싣는다. */
private val BASE_EPISODE_BUCKETS = listOf("1" to 1..1, "2" to 2..2, "3" to 3..3, "4-5" to 4..5, "6-10" to 6..10, "11+" to 11..Int.MAX_VALUE)

/**
 * 운영 퍼널 지표(DEC-57)다. 전체 기간의 수만 세어 돌려주고 비율·오차는 화면이 계산한다. 값마다 count·집계 쿼리 하나이고 칸별로 세는 곳은
 * 계약 1번 절의 '세는 곳' 표다. AI 제안 채택과 수정 제안 승인은 운영 통계([OperationsStatsService], DEC-55)의 정의를 전체 기간(1970-01-01~지금)으로 그대로 쓴다.
 * ponytail: 중앙값은 발행한 Fork마다 [생성, 첫 발행] 한 행을 모두 읽어 서비스에서 계산한다(Fork가 수만 개가 되면 DB 백분위수 집계로 옮긴다).
 */
@Service
@Transactional(transactionManager = "contentTransactionManager", readOnly = true)
class OperationsFunnelService(
    private val views: WorkViewRepository,
    private val readings: ReadingEpisodeRepository,
    private val likes: WorkLikeRepository,
    private val interests: WorkInterestRepository,
    private val comments: EpisodeCommentRepository,
    private val episodes: EpisodeCurrentRepository,
    private val forks: ForkRepository,
    private val stats: OperationsStatsService,
) {
    fun funnel(now: Instant = Instant.now()): OperationsFunnelResponse {
        // forks.readers는 readers.readAny와 같은 집단이라 한 번만 센다. 발행한 Fork 수(published)도 중앙값을 위해 읽는 행 수와 같다.
        val readers = readings.countReaders()
        val firstPublications = forks.firstPublications()
        return OperationsFunnelResponse(
            readers = FunnelReaders(viewed = views.countViewers(), readAny = readers, readNext = readings.countRepeatReaders()),
            reactions = FunnelReactions(publishedEpisodes = episodes.countPublished(), likes = likes.countOfLiveWorks(), interests = interests.countOfLiveWorks(), comments = comments.countVisible()),
            forks = FunnelForks(readers = readers, readerForked = forks.countOwnersWhoRead(), baseEpisodes = baseEpisodeBuckets(forks.countByBaseEpisode())),
            writers = FunnelWriters(forks = forks.countLive(), saved = forks.countSaved(), published = firstPublications.size.toLong(), medianHoursToPublish = medianHours(firstPublications)),
            proposals = stats.proposalDecisions(Instant.EPOCH, now),
            feedback = stats.editSuggestions(Instant.EPOCH, now),
        )
    }

    /** [기준 회차, Fork 수] 행을 여섯 구간으로 합친다. */
    private fun baseEpisodeBuckets(rows: List<Array<Any>>) = BASE_EPISODE_BUCKETS.map { (label, range) ->
        BaseEpisodeBucket(label, rows.filter { (it[0] as Number).toInt() in range }.sumOf { (it[1] as Number).toLong() })
    }

    /** [생성 시각, 첫 직접 발행 시각] 행의 시간 차이(시간 단위) 중앙값을 소수 1자리로 맞춘다. 행이 없으면 null이다. */
    private fun medianHours(firstPublications: List<Array<Any>>): Double? {
        val hours = firstPublications.map { Duration.between(it[0] as Instant, it[1] as Instant).toMillis() / 3_600_000.0 }.sorted()
        if (hours.isEmpty()) return null
        val middle = hours.size / 2
        val median = if (hours.size % 2 == 1) hours[middle] else (hours[middle - 1] + hours[middle]) / 2
        return Math.round(median * 10) / 10.0
    }
}
