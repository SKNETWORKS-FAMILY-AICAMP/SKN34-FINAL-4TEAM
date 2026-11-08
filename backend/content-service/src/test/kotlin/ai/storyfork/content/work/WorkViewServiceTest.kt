package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode_version.repository.CheckpointRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity
import ai.storyfork.content.publication.repository.WorkPublicationHistoryRepository
import ai.storyfork.content.work.domain.WorkViews
import ai.storyfork.content.work.domain.viewDate
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.entity.WorkViewEntity
import ai.storyfork.content.work.entity.WorkWorldHistoryEntity
import ai.storyfork.content.work.repository.ForkPolicyHistoryRepository
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.repository.WorkViewRepository
import ai.storyfork.content.work.repository.WorkWorldHistoryRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkViewService
import jakarta.persistence.EntityManager
import java.math.BigInteger
import java.time.Duration
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.springframework.dao.DataIntegrityViolationException

@ExtendWith(MockitoExtension::class)
class WorkViewServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var current: EpisodeCurrentRepository
    @Mock lateinit var views: WorkViewRepository
    @InjectMocks lateinit var service: WorkViewService

    private fun anyKey() = ArgumentMatchers.any(WorkViewEntity.Key::class.java) ?: WorkViewEntity.Key()
    private fun anyEntity() = ArgumentMatchers.any(WorkViewEntity::class.java) ?: WorkViewEntity()
    private fun published(number: Int = 1) {
        `when`(current.findByWorkIdAndSequence("work", number)).thenReturn(EpisodeCurrentEntity("episode-$number", "work", number, "version-$number"))
    }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `first view of the day is stored with the Seoul date of its timestamp`() {
        published()
        `when`(views.saveAndFlush(anyEntity())).thenAnswer { it.arguments[0] }

        service.record("work", 1, "reader")

        val saved = ArgumentCaptor.forClass(WorkViewEntity::class.java)
        verify(views).saveAndFlush(saved.capture() ?: WorkViewEntity())
        assertEquals(listOf<Any>("work", 1, "reader"), listOf(saved.value.workId, saved.value.episodeNumber, saved.value.memberId))
        assertEquals(viewDate(saved.value.viewedAt), saved.value.viewDate)
        assertTrue(Duration.between(saved.value.viewedAt, Instant.now()).abs() < Duration.ofMinutes(1))
        verify(access).published("work")
    }

    @Test fun `repeat view on the same day stores nothing`() {
        published()
        `when`(views.existsById(anyKey())).thenReturn(true)

        service.record("work", 1, "reader")

        verify(views, never()).saveAndFlush(anyEntity())
    }

    @Test fun `private or missing work is 404 before any episode lookup`() {
        `when`(access.published("work")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(404, failure { service.record("work", 1, "reader") }.status)

        verifyNoInteractions(current, views)
    }

    @Test fun `restricted public work is 404 before any episode lookup`() {
        val works = mock(WorkRepository::class.java)
        val worlds = mock(WorkWorldHistoryRepository::class.java)
        val visibility = mock(WorkPublicationHistoryRepository::class.java)
        `when`(works.findById("work")).thenReturn(Optional.of(WorkEntity(id = "work", ownerId = "author", restricted = true)))
        `when`(worlds.findFirstByWorkIdOrderByRevisionNoDesc("work")).thenReturn(WorkWorldHistoryEntity(workId = "work", worldId = "world"))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("work")).thenReturn(WorkPublicationHistoryEntity(workId = "work", visibility = "public"))
        val restricted = WorkAccessService(works, worlds, visibility, mock(ForkPolicyHistoryRepository::class.java), mock(ForkRepository::class.java),
            mock(CheckpointRepository::class.java), mock(EpisodeRepository::class.java), mock(EpisodeVersionRepository::class.java), mock(EntityManager::class.java))

        assertEquals(404, failure { WorkViewService(restricted, current, views).record("work", 1, "reader") }.status)

        verifyNoInteractions(current, views)
    }

    @Test fun `unpublished or unknown episode is 404 and stores nothing`() {
        `when`(current.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeCurrentEntity("episode-2", "work", 2, null))

        for (number in listOf(2, 3, 0, -1)) assertEquals(404, failure { service.record("work", number, "reader") }.status, "$number")

        verifyNoInteractions(views)
    }

    @Test fun `blank member is rejected as unauthenticated before any lookup`() {
        assertEquals(401, failure { service.record("work", 1, " ") }.status)

        verifyNoInteractions(access, current, views)
    }

    @Test fun `a concurrent duplicate insert is ignored once the row exists`() {
        published()
        `when`(views.existsById(anyKey())).thenReturn(false, true)
        `when`(views.saveAndFlush(anyEntity())).thenThrow(DataIntegrityViolationException("duplicate key"))

        assertDoesNotThrow { service.record("work", 1, "reader") }

        verify(views, times(2)).existsById(anyKey())
    }

    @Test fun `other integrity failures are not swallowed`() {
        published()
        `when`(views.saveAndFlush(anyEntity())).thenThrow(DataIntegrityViolationException("foreign key"))

        assertThrows(DataIntegrityViolationException::class.java) { service.record("work", 1, "reader") }
    }

    @Test fun `counts map the aggregate rows of the last two 24 hour windows`() {
        `when`(views.countByWork(ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH, ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH))
            .thenReturn(listOf(arrayOf<Any>("w1", 3L, 1L), arrayOf<Any>("w2", 2, BigInteger.ZERO)))

        assertEquals(mapOf("w1" to WorkViews(3, 1), "w2" to WorkViews(2, 0)), service.counts())

        val from = ArgumentCaptor.forClass(Instant::class.java)
        val split = ArgumentCaptor.forClass(Instant::class.java)
        verify(views).countByWork(from.capture() ?: Instant.EPOCH, split.capture() ?: Instant.EPOCH)
        assertEquals(Duration.ofHours(24), Duration.between(from.value, split.value))
        assertTrue(Duration.between(split.value, Instant.now()) in Duration.ofHours(24)..Duration.ofHours(24).plusMinutes(1))
    }
}
