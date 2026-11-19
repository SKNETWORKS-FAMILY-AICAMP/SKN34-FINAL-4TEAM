package ai.storyfork.content.fork

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode_version.entity.CheckpointEntity
import ai.storyfork.content.episode_version.repository.CheckpointRepository
import ai.storyfork.content.fork.entity.ForkEntity
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.fork.service.ForkLeakReferenceService
import ai.storyfork.content.fork.service.dto.LeakReferencesResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.world.service.PublicWorldService
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/**
 * 운영 정보 누설 비교 기준(DEC-55) 조립: 저장소·공개 세계관 조회는 대역이다. 안 보이는 카드 판정(DEC-53)은 WorldHiddenCardTitlesTest가,
 * 실제 쿼리·HTTP·서비스 토큰은 CI의 InternalLeakReferencesIntegrationTest가 확인한다.
 */
class ForkLeakReferenceServiceTest {
    private val works = mock(WorkRepository::class.java)
    private val forks = mock(ForkRepository::class.java)
    private val checkpoints = mock(CheckpointRepository::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val publicWorlds = mock(PublicWorldService::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = ForkLeakReferenceService(works, forks, checkpoints, episodes, current, publicWorlds, TransactionTemplate(manager))
    private val originWorld = UUID.randomUUID()

    private fun work(id: String, world: UUID? = null, deleted: Boolean = false) =
        WorkEntity(id = id, ownerId = "owner", title = id, worldStudioId = world, deletedAt = Instant.now().takeIf { deleted })

    /** 원작 "origin"의 [basis]화에서 갈라진 Fork "fork"다. */
    private fun fork(basis: Int = 5, originWorld: UUID? = this.originWorld) {
        `when`(works.findById("fork")).thenReturn(Optional.of(work("fork")))
        `when`(works.findById("origin")).thenReturn(Optional.of(work("origin", originWorld)))
        `when`(forks.findById("fork")).thenReturn(Optional.of(ForkEntity(workId = "fork", sourceWorkId = "origin", ownerId = "owner", sourceCheckpointId = "cp")))
        `when`(checkpoints.findById("cp")).thenReturn(Optional.of(CheckpointEntity(id = "cp", workId = "origin", episodeId = "origin-e$basis", basisEpisodeVersionId = "v")))
        `when`(episodes.findById("origin-e$basis")).thenReturn(Optional.of(EpisodeEntity(id = "origin-e$basis", workId = "origin", sequence = basis)))
    }

    private fun titles(vararg rows: Pair<String?, String?>) = `when`(current.titlesAfter("origin", 5)).thenReturn(rows.map { arrayOf<Any?>(it.first, it.second) })

    @Test fun `a Fork gets its origin the cards hidden at the basis episode and the origin episode titles after it`() {
        fork()
        `when`(publicWorlds.hiddenCardTitles(originWorld, 5)).thenReturn(listOf("작가 전용 인물", "7화 공개 사건"))
        titles("6화 초안" to "6화 발행", "7화" to null, null to "8화 발행만")

        assertEquals(
            LeakReferencesResponse("origin", listOf("작가 전용 인물", "7화 공개 사건"), listOf("6화 발행", "6화 초안", "7화", "8화 발행만")),
            service.read("fork"),
        )
        verify(current).titlesAfter("origin", 5)
    }

    @Test fun `a work that is not a Fork has no origin and nothing is read beyond the work and its Fork row`() {
        `when`(works.findById("plain")).thenReturn(Optional.of(work("plain")))

        assertEquals(LeakReferencesResponse(null, emptyList(), emptyList()), service.read("plain"))

        verify(forks).findById("plain")
        verifyNoInteractions(checkpoints, episodes, current, publicWorlds)
    }

    @Test fun `a missing or deleted work is 404 and nothing else is read`() {
        `when`(works.findById("gone")).thenReturn(Optional.of(work("gone", deleted = true)))

        listOf("gone", "unknown").forEach { assertEquals(404, assertThrows(ContentFailure::class.java) { service.read(it) }.status, it) }

        verifyNoInteractions(forks, checkpoints, episodes, current, publicWorlds)
    }

    @Test fun `an origin without a linked world has no card titles and its world is never read`() {
        fork(originWorld = null)
        titles("6화" to null)

        assertEquals(LeakReferencesResponse("origin", emptyList(), listOf("6화")), service.read("fork"))

        verifyNoInteractions(publicWorlds)
    }

    @Test fun `blank titles the default new episode title and duplicates are not comparison material`() {
        fork()
        `when`(publicWorlds.hiddenCardTitles(originWorld, 5)).thenReturn(listOf("", "  ", "작가 전용 인물"))
        titles("새 회차" to "새 회차", "" to " ", "같은 제목" to "같은 제목", "같은 제목" to null)

        val response = service.read("fork")

        assertEquals(listOf("작가 전용 인물"), response.privateCardTitles)
        assertEquals(listOf("같은 제목"), response.unpublishedEpisodeTitles)
    }

    @Test fun `a Fork whose pinned basis cannot be read is 409`() {
        fork()
        `when`(checkpoints.findById("cp")).thenReturn(Optional.empty())

        assertEquals(409, assertThrows(ContentFailure::class.java) { service.read("fork") }.status)

        verifyNoInteractions(current, publicWorlds)
    }

    @Test fun `the content transaction ends before the WorldStudio read starts`() {
        fork()
        `when`(publicWorlds.hiddenCardTitles(originWorld, 5)).thenReturn(emptyList())

        service.read("fork")

        val order = inOrder(manager, publicWorlds)
        order.verify(manager).commit(any())
        order.verify(publicWorlds).hiddenCardTitles(originWorld, 5)
    }

    @Test fun `the response serializes to the contract names and keeps a null origin explicit`() {
        val json = JsonMapper.builder().findAndAddModules().build()

        assertEquals(json.readTree("""{"originWorkId":null,"privateCardTitles":[],"unpublishedEpisodeTitles":[]}"""), json.readTree(json.writeValueAsString(LeakReferencesResponse(null, emptyList(), emptyList()))))
        assertEquals(json.readTree("""{"originWorkId":"o","privateCardTitles":["카드"],"unpublishedEpisodeTitles":["회차"]}"""), json.readTree(json.writeValueAsString(LeakReferencesResponse("o", listOf("카드"), listOf("회차")))))
    }
}
