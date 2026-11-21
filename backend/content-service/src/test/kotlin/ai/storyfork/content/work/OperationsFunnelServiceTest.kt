package ai.storyfork.content.work

import ai.storyfork.content.comment.repository.EpisodeCommentRepository
import ai.storyfork.content.editsuggestion.repository.EditSuggestionRepository
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.feedbackreport.repository.FeedbackReportRepository
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.interest.repository.WorkInterestRepository
import ai.storyfork.content.like.repository.WorkLikeRepository
import ai.storyfork.content.proposal.repository.AiProposalRepository
import ai.storyfork.content.reading.repository.ReadingEpisodeRepository
import ai.storyfork.content.work.repository.WorkViewRepository
import ai.storyfork.content.work.service.OperationsFunnelService
import ai.storyfork.content.work.service.OperationsStatsService
import ai.storyfork.content.work.service.dto.BaseEpisodeBucket
import ai.storyfork.content.work.service.dto.EditSuggestionStats
import ai.storyfork.content.work.service.dto.FunnelForks
import ai.storyfork.content.work.service.dto.FunnelReactions
import ai.storyfork.content.work.service.dto.FunnelReaders
import ai.storyfork.content.work.service.dto.FunnelWriters
import ai.storyfork.content.work.service.dto.OperationsFunnelResponse
import ai.storyfork.content.work.service.dto.ProposalDecisionStats
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.databind.json.JsonMapper

/** 운영 퍼널 집계(DEC-57) 조립을 저장소 대역으로 검증한다. 실제 JPQL·HTTP·서비스 토큰은 InternalOperationsFunnelIntegrationTest가 CI에서 확인한다. */
class OperationsFunnelServiceTest {
    private val views = mock(WorkViewRepository::class.java)
    private val readings = mock(ReadingEpisodeRepository::class.java)
    private val likes = mock(WorkLikeRepository::class.java)
    private val interests = mock(WorkInterestRepository::class.java)
    private val comments = mock(EpisodeCommentRepository::class.java)
    private val episodes = mock(EpisodeCurrentRepository::class.java)
    private val forks = mock(ForkRepository::class.java)
    private val suggestions = mock(EditSuggestionRepository::class.java)
    private val proposals = mock(AiProposalRepository::class.java)
    // 채택·수정 제안 정의는 운영 통계(DEC-55)의 것을 그대로 쓰므로 진짜 서비스를 저장소 대역 위에 둔다.
    private val service = OperationsFunnelService(views, readings, likes, interests, comments, episodes, forks,
        OperationsStatsService(mock(FeedbackReportRepository::class.java), suggestions, proposals))
    private val now = Instant.parse("2026-11-21T03:00:00Z")

    /** Fork 생성 시각과 첫 직접 발행 시각의 [minutes]분 차이를 쿼리 행([생성, 첫 발행]) 모양으로 만든다. */
    private fun firstPublication(minutes: Long) = Instant.parse("2026-11-01T00:00:00Z").let { arrayOf<Any>(it, it.plusSeconds(minutes * 60)) }
    private fun baseEpisodes(vararg countBySequence: Pair<Int, Long>) =
        countBySequence.map { (sequence, count) -> arrayOf<Any>(sequence, count) }

    @Test fun `every cell comes from its own count, forks readers is the same cohort and the proposal and suggestion cells are the stats definition over all time`() {
        `when`(views.countViewers()).thenReturn(40)
        `when`(readings.countReaders()).thenReturn(30)
        `when`(readings.countRepeatReaders()).thenReturn(12)
        `when`(episodes.countPublished()).thenReturn(25)
        `when`(likes.countOfLiveWorks()).thenReturn(9)
        `when`(interests.countOfLiveWorks()).thenReturn(7)
        `when`(comments.countVisible()).thenReturn(5)
        `when`(forks.countOwnersWhoRead()).thenReturn(4)
        `when`(forks.countByBaseEpisode()).thenReturn(baseEpisodes(1 to 2L, 3 to 1L))
        `when`(forks.countLive()).thenReturn(6)
        `when`(forks.countSaved()).thenReturn(3)
        `when`(forks.firstPublications()).thenReturn(listOf(firstPublication(120), firstPublication(240)))
        // 전체 기간은 1970-01-01부터 지금까지다. 다른 창으로 물으면 대역이 0을 돌려줘 아래 비교가 깨진다.
        `when`(proposals.countAdoptedByCreatedAtBetween(Instant.EPOCH, now)).thenReturn(8)
        `when`(proposals.countByCreatedAtBetween(Instant.EPOCH, now)).thenReturn(20)
        `when`(suggestions.countByStatusAndDecidedAtBetween("approved", Instant.EPOCH, now)).thenReturn(3)
        `when`(suggestions.countByStatusAndDecidedAtBetween("rejected", Instant.EPOCH, now)).thenReturn(1)

        assertEquals(
            OperationsFunnelResponse(
                readers = FunnelReaders(viewed = 40, readAny = 30, readNext = 12),
                reactions = FunnelReactions(publishedEpisodes = 25, likes = 9, interests = 7, comments = 5),
                forks = FunnelForks(readers = 30, readerForked = 4, baseEpisodes = listOf(
                    BaseEpisodeBucket("1", 2), BaseEpisodeBucket("2", 0), BaseEpisodeBucket("3", 1),
                    BaseEpisodeBucket("4-5", 0), BaseEpisodeBucket("6-10", 0), BaseEpisodeBucket("11+", 0))),
                writers = FunnelWriters(forks = 6, saved = 3, published = 2, medianHoursToPublish = 3.0),
                proposals = ProposalDecisionStats(adopted = 8, total = 20),
                feedback = EditSuggestionStats(approved = 3, decided = 4),
            ),
            service.funnel(now),
        )
        verify(readings, times(1)).countReaders()
    }

    @Test fun `the base episode distribution is six fixed buckets in order and the empty ones are zero`() {
        `when`(forks.countByBaseEpisode()).thenReturn(baseEpisodes(1 to 2L, 2 to 1L, 3 to 4L, 4 to 1L, 5 to 2L, 6 to 1L, 10 to 3L, 11 to 1L, 40 to 2L))
        assertEquals(
            listOf("1" to 2L, "2" to 1L, "3" to 4L, "4-5" to 3L, "6-10" to 4L, "11+" to 3L),
            service.funnel(now).forks.baseEpisodes.map { it.bucket to it.count },
        )

        `when`(forks.countByBaseEpisode()).thenReturn(emptyList())
        assertEquals(
            listOf("1" to 0L, "2" to 0L, "3" to 0L, "4-5" to 0L, "6-10" to 0L, "11+" to 0L),
            service.funnel(now).forks.baseEpisodes.map { it.bucket to it.count },
        )
    }

    @Test fun `published counts the forks with a first direct publication and the median of their hours is rounded to one decimal`() {
        fun writers(vararg minutes: Long): FunnelWriters {
            `when`(forks.firstPublications()).thenReturn(minutes.map(::firstPublication))
            return service.funnel(now).writers
        }
        // 홀수는 가운데 값(입력 순서와 무관), 짝수는 가운데 두 값의 평균이다.
        assertEquals(listOf(3L, 4.0), writers(600, 120, 240).let { listOf(it.published, it.medianHoursToPublish) })
        assertEquals(listOf(4L, 2.5), writers(60, 120, 180, 480).let { listOf(it.published, it.medianHoursToPublish) })
        // 1.666…시간은 소수 1자리로 맞추고, 곧바로 발행한 0시간은 null이 아니라 0.0이다.
        assertEquals(1.7, writers(100).medianHoursToPublish)
        assertEquals(0.0, writers(0).medianHoursToPublish)
        // 발행한 Fork가 없으면 중앙값은 null이다.
        assertEquals(listOf(0L, null), writers().let { listOf(it.published, it.medianHoursToPublish) })
    }

    @Test fun `the response serializes to the contract field names and a missing median stays an explicit null`() {
        val json = JsonMapper.builder().findAndAddModules().build()
        val tree = json.readTree(json.writeValueAsString(service.funnel(now)))

        assertEquals(setOf("readers", "reactions", "forks", "writers", "proposals", "feedback"), tree.propertyNames().toSet())
        assertEquals(setOf("viewed", "readAny", "readNext"), tree.path("readers").propertyNames().toSet())
        assertEquals(setOf("publishedEpisodes", "likes", "interests", "comments"), tree.path("reactions").propertyNames().toSet())
        assertEquals(setOf("readers", "readerForked", "baseEpisodes"), tree.path("forks").propertyNames().toSet())
        assertTrue(tree.path("forks").path("baseEpisodes").isArray)
        assertEquals(setOf("bucket", "count"), tree.path("forks").path("baseEpisodes")[0].propertyNames().toSet())
        assertEquals(setOf("forks", "saved", "published", "medianHoursToPublish"), tree.path("writers").propertyNames().toSet())
        assertTrue(tree.path("writers").path("medianHoursToPublish").isNull)
        assertEquals(setOf("adopted", "total"), tree.path("proposals").propertyNames().toSet())
        assertEquals(setOf("approved", "decided"), tree.path("feedback").propertyNames().toSet())
    }
}
