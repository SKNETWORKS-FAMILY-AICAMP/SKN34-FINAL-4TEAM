package ai.storyfork.content.serial

import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.serial.entity.AiSerialEntity
import ai.storyfork.content.serial.entity.SerialEpisodeSummaryEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.serial.repository.SerialEpisodeSummaryRepository
import ai.storyfork.content.serial.service.SerialSummaryService
import ai.storyfork.content.serial.service.SummaryTarget
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import java.time.Instant
import java.time.LocalTime
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*

/** 회차 요약의 DB 쪽 규칙(요약할 회차 고르기·저장·문맥용 조회)을 DB 없이 검증한다. 저장소는 메모리 대역이고 AI·Core 호출은 여기서 하지 않는다. */
class SerialSummaryServiceTest {
    private val t0 = Instant.parse("2026-11-23T12:10:00Z")
    private val serialRepo = mock(AiSerialRepository::class.java)
    private val works = mock(WorkRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val versions = mock(EpisodeVersionRepository::class.java)
    private val summaryRepo = mock(SerialEpisodeSummaryRepository::class.java)
    private val service = SerialSummaryService(serialRepo, works, current, versions, summaryRepo)

    private val settings = mutableMapOf<String, AiSerialEntity>()
    private val workRows = mutableMapOf<String, WorkEntity>()
    private val episodeRows = mutableListOf<EpisodeCurrentEntity>()
    private val versionRows = mutableMapOf<String, EpisodeVersionEntity>()
    private val summaryRows = mutableMapOf<String, SerialEpisodeSummaryEntity>()

    init {
        `when`(serialRepo.findAllByEnabledTrue()).thenAnswer { settings.values.filter { it.enabled } }
        `when`(works.findById(ArgumentMatchers.anyString())).thenAnswer { Optional.ofNullable(workRows[it.arguments[0]]) }
        `when`(current.findAllByWorkIdOrderBySequence(ArgumentMatchers.anyString())).thenAnswer { call -> episodeRows.filter { it.workId == call.arguments[0] }.sortedBy { it.sequence } }
        `when`(versions.findById(ArgumentMatchers.anyString())).thenAnswer { Optional.ofNullable(versionRows[it.arguments[0]]) }
        `when`(summaryRepo.findAllByEpisodeIdIn(ArgumentMatchers.anyCollection<String>())).thenAnswer { call -> (call.arguments[0] as Collection<*>).mapNotNull { summaryRows[it] } }
        `when`(summaryRepo.findById(ArgumentMatchers.anyString())).thenAnswer { Optional.ofNullable(summaryRows[it.arguments[0]]) }
        `when`(summaryRepo.save(ArgumentMatchers.any(SerialEpisodeSummaryEntity::class.java) ?: SerialEpisodeSummaryEntity())).thenAnswer { call ->
            (call.arguments[0] as SerialEpisodeSummaryEntity).also { summaryRows[it.episodeId] = it }
        }
    }

    private fun work(id: String, owner: String = "owner-$id", enabled: Boolean = true, deleted: Boolean = false) {
        workRows[id] = WorkEntity(id = id, ownerId = owner, title = "작품 $id", description = "소개", deletedAt = if (deleted) t0 else null)
        settings[id] = AiSerialEntity(id, enabled, "MON", LocalTime.of(21, 0), "", null, t0)
    }

    /** [sequence]화(id e-<작품>-<번호>)와 그 발행 버전(v-<작품>-<번호>)이다. [published]가 false면 발행본이 없다(초안·공개 중단). */
    private fun episode(workId: String, sequence: Int, published: Boolean = true) {
        val id = "e-$workId-$sequence"
        val version = "v-$workId-$sequence"
        versionRows[version] = EpisodeVersionEntity(id = version, episodeId = id, contentVersionId = "cv-$version", revisionNo = 1, title = "제 ${sequence}화", content = "본문 $sequence")
        episodeRows.add(EpisodeCurrentEntity(id = id, workId = workId, sequence = sequence, publishedVersionId = if (published) version else null))
    }

    private fun summary(workId: String, sequence: Int, version: String = "v-$workId-$sequence") {
        summaryRows["e-$workId-$sequence"] = SerialEpisodeSummaryEntity("e-$workId-$sequence", version, "요약 $sequence", t0)
    }

    @Test fun `targets are the published episodes without a current summary oldest first up to the limit`() {
        work("w")
        (1..5).forEach { episode("w", it) }
        summary("w", 1) // 현재 발행 버전의 요약이 있다.
        summary("w", 3, version = "old") // 발행 버전이 바뀐 낡은 요약이라 다시 만든다.

        val targets = service.targets(3)

        assertEquals(listOf(2, 3, 4), targets.map { it.number })
        assertEquals(SummaryTarget("w", "owner-w", "e-w-2", "v-w-2", 2, "제 2화", "본문 2"), targets.first())
    }

    @Test fun `unpublished and suspended episodes are not summarized`() {
        work("w")
        episode("w", 1); episode("w", 2, published = false); episode("w", 3)

        assertEquals(listOf(1, 3), service.targets(10).map { it.number })
    }

    @Test fun `works take turns one episode each and disabled or deleted works are skipped`() {
        work("a"); episode("a", 1); episode("a", 2)
        work("off", enabled = false); episode("off", 1)
        work("gone", deleted = true); episode("gone", 1)
        work("b"); episode("b", 1); episode("b", 2)

        // 작품을 돌려 가며 오래된 회차부터 하나씩 고른다(한 작품 안에서는 번호순).
        assertEquals(listOf("a" to 1, "b" to 1, "a" to 2), service.targets(3).map { it.workId to it.number })
        verify(versions, never()).findById("v-off-1")
        verify(versions, never()).findById("v-gone-1")
    }

    @Test fun `a work that keeps failing cannot take every slot from the other works`() {
        // 크레딧이 모자라 계속 실패하는 작품 a에 미요약 회차가 많아도 매 점검 b·c도 한 자리씩 받는다.
        work("a"); (1..5).forEach { episode("a", it) }
        work("b"); episode("b", 1)
        work("c"); episode("c", 1)

        assertEquals(listOf("a" to 1, "b" to 1, "c" to 1), service.targets(3).map { it.workId to it.number })
        assertEquals(listOf("a" to 1, "b" to 1, "c" to 1, "a" to 2, "a" to 3), service.targets(5).map { it.workId to it.number })
    }

    @Test fun `when everything has a current summary nothing is loaded`() {
        work("w"); episode("w", 1); episode("w", 2); summary("w", 1); summary("w", 2)

        assertEquals(emptyList<SummaryTarget>(), service.targets(3))
        verifyNoInteractions(versions)
    }

    @Test fun `a work without published episodes is not even looked up in the summary table`() {
        work("w"); episode("w", 1, published = false)

        assertEquals(emptyList<SummaryTarget>(), service.targets(3))
        verifyNoInteractions(summaryRepo)
    }

    @Test fun `a limit of zero picks nothing`() {
        work("w"); episode("w", 1)

        assertEquals(emptyList<SummaryTarget>(), service.targets(0))
    }

    @Test fun `saving creates the row and a new published version replaces it`() {
        service.save("e1", "v1", "첫 요약")
        assertEquals(listOf("v1", "첫 요약"), summaryRows.getValue("e1").let { listOf(it.versionId, it.summary) })

        service.save("e1", "v2", "새 요약")

        assertEquals(1, summaryRows.size)
        assertEquals(listOf("v2", "새 요약"), summaryRows.getValue("e1").let { listOf(it.versionId, it.summary) })
    }

    @Test fun `stored summaries are those of the current published version keyed by episode number`() {
        work("w")
        (1..4).forEach { episode("w", it) }
        episode("w", 5, published = false)
        summary("w", 1); summary("w", 2, version = "old"); summary("w", 4); summary("w", 5)

        assertEquals(mapOf(1 to "요약 1", 4 to "요약 4"), service.stored("w"))
        assertEquals(emptyMap<Int, String>(), service.stored("none"))
    }
}
