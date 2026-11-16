package ai.storyfork.content.interest

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.entity.WorkInterestEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import ai.storyfork.content.interest.repository.WorkInterestRepository
import ai.storyfork.content.interest.service.WorkInterestService
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Instant
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
class WorkInterestServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var current: EpisodeCurrentRepository
    @Mock lateinit var interests: WorkInterestRepository
    @Mock lateinit var outbox: ContentEventOutboxRepository
    @InjectMocks lateinit var service: WorkInterestService

    private fun anyKey() = ArgumentMatchers.any(WorkInterestEntity.Key::class.java) ?: WorkInterestEntity.Key()
    private fun anyEntity() = ArgumentMatchers.any(WorkInterestEntity::class.java) ?: WorkInterestEntity()
    private fun work(id: String, visibility: String = "public", restricted: Boolean = false) =
        WorkAccessResult(id, "author", "제목", "", 0, "world", visibility, true, true, null, restricted)
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)
    private fun interest(work: String, member: String) = WorkInterestEntity(work, member, Instant.parse("2026-11-09T00:00:00Z"))

    @Test fun `adding a public work stores one row for the member`() {
        `when`(access.published("work")).thenReturn(work("work"))
        `when`(interests.saveAndFlush(anyEntity())).thenAnswer { it.arguments[0] }

        service.add("work", "reader")

        val saved = ArgumentCaptor.forClass(WorkInterestEntity::class.java)
        verify(interests).saveAndFlush(saved.capture() ?: WorkInterestEntity())
        assertEquals(listOf("work", "reader"), listOf(saved.value.workId, saved.value.memberId))
    }

    @Test fun `adding again is a no-op`() {
        `when`(access.published("work")).thenReturn(work("work"))
        `when`(interests.existsById(anyKey())).thenReturn(true)

        service.add("work", "reader")

        verify(interests, never()).saveAndFlush(anyEntity())
    }

    @Test fun `private restricted or missing work is 404 before anything is stored`() {
        `when`(access.published("work")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(404, failure { service.add("work", "reader") }.status)
        assertEquals(404, failure { service.remove("work", "reader") }.status)

        verifyNoInteractions(interests, outbox)
    }

    @Test fun `blank or oversized member is 401 before any lookup`() {
        for (member in listOf(" ", "x".repeat(201))) {
            assertEquals(401, failure { service.add("work", member) }.status)
            assertEquals(401, failure { service.remove("work", member) }.status)
            assertEquals(401, failure { service.list(member) }.status)
        }

        verifyNoInteractions(access, interests, outbox)
    }

    @Test fun `a concurrent duplicate insert is ignored once the row exists`() {
        `when`(access.published("work")).thenReturn(work("work"))
        `when`(interests.existsById(anyKey())).thenReturn(false, true)
        `when`(interests.saveAndFlush(anyEntity())).thenThrow(DataIntegrityViolationException("duplicate key"))

        assertDoesNotThrow { service.add("work", "reader") }

        verify(interests, times(2)).existsById(anyKey())
    }

    @Test fun `other integrity failures are not swallowed`() {
        `when`(access.published("work")).thenReturn(work("work"))
        `when`(interests.saveAndFlush(anyEntity())).thenThrow(DataIntegrityViolationException("foreign key"))

        assertThrows(DataIntegrityViolationException::class.java) { service.add("work", "reader") }
    }

    @Test fun `removing deletes only the caller's row of a public work`() {
        `when`(access.published("work")).thenReturn(work("work"))

        service.remove("work", "reader")

        verify(interests).deleteById(WorkInterestEntity.Key("work", "reader"))
        verifyNoMoreInteractions(interests)
    }

    @Test fun `list keeps the newest first order and drops works that are no longer public`() {
        `when`(interests.findAllByMemberIdOrderByCreatedAtDescWorkIdAsc("reader"))
            .thenReturn(listOf(interest("newest", "reader"), interest("hidden", "reader"), interest("restricted", "reader"), interest("oldest", "reader")))
        `when`(access.get("newest")).thenReturn(work("newest"))
        `when`(access.get("hidden")).thenReturn(work("hidden", visibility = "private"))
        `when`(access.get("restricted")).thenReturn(work("restricted", restricted = true))
        `when`(access.get("oldest")).thenReturn(work("oldest"))

        assertEquals(listOf("newest", "oldest"), service.list("reader").workIds)
    }

    @Test fun `list is empty without a lookup when the member has no interest`() {
        assertEquals(emptyList<String>(), service.list("reader").workIds)

        verifyNoInteractions(access)
    }

    /** 서비스가 outbox에 저장하려고 넘긴 모든 행. 한 번도 저장하지 않았으면 빈 목록이다. */
    private fun savedOutbox(): List<ContentEventOutboxEntity> = mockingDetails(outbox).invocations
        .filter { it.method.name == "saveAll" }.flatMap { it.getArgument<Iterable<ContentEventOutboxEntity>>(0).toList() }

    @Test fun `a new episode writes one outbox row per interested member except the author`() {
        `when`(current.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeCurrentEntity("episode-2", "work", 2, null))
        `when`(access.get("work")).thenReturn(work("work"))
        `when`(interests.findAllByWorkId("work")).thenReturn(listOf(interest("work", "reader-1"), interest("work", "author"), interest("work", "reader-2")))

        service.episodePublished("work", "author", 2)

        val rows = savedOutbox()
        assertEquals(listOf("reader-1", "reader-2"), rows.map { it.recipientId })
        assertTrue(rows.all { it.type == "content.episode.published" && it.targetType == "work" && it.targetId == "work" && it.publishedAt == null })
        assertEquals(2, rows.map { it.id }.toSet().size)
        assertEquals(1, rows.map { it.occurredAt }.toSet().size)
    }

    @Test fun `republishing an episode that was already published is not a new episode`() {
        `when`(current.findByWorkIdAndSequence("work", 1)).thenReturn(EpisodeCurrentEntity("episode-1", "work", 1, "version-1"))

        service.episodePublished("work", "author", 1)

        verifyNoInteractions(access, interests, outbox)
    }

    @Test fun `a work that is not publicly visible notifies nobody`() {
        `when`(current.findByWorkIdAndSequence("work", 1)).thenReturn(EpisodeCurrentEntity("episode-1", "work", 1, null))
        `when`(access.get("work")).thenReturn(work("work", restricted = true))

        service.episodePublished("work", "author", 1)

        verifyNoInteractions(interests, outbox)
    }

    @Test fun `no outbox row is written when only the author is interested`() {
        `when`(current.findByWorkIdAndSequence("work", 3)).thenReturn(EpisodeCurrentEntity("episode-3", "work", 3, null))
        `when`(access.get("work")).thenReturn(work("work"))
        `when`(interests.findAllByWorkId("work")).thenReturn(listOf(interest("work", "author")))

        service.episodePublished("work", "author", 3)

        assertEquals(emptyList<ContentEventOutboxEntity>(), savedOutbox())
    }
}
