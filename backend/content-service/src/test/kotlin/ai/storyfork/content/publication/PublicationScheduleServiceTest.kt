package ai.storyfork.content.publication

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.publication.entity.PublicationScheduleEntity
import ai.storyfork.content.publication.repository.PublicationScheduleRepository
import ai.storyfork.content.publication.service.PublicationScheduleService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublicationScheduleRequest
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

class PublicationScheduleServiceTest {
    private val owner = UUID.randomUUID().toString()
    private val due = Instant.now().minusSeconds(10)
    private val access = mock(WorkAccessService::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val writing = mock(EpisodeService::class.java)
    private val schedules = mock(PublicationScheduleRepository::class.java)
    private val publication = mock(PublicationService::class.java)
    private val auth = mock(CoreAuthVerificationService::class.java)
    private val service = PublicationScheduleService(
        access, episodes, writing, schedules, publication, auth,
        // 모의 매니저가 status를 돌려줘야 executeWithoutResult 안에서 NPE가 나지 않는다.
        TransactionTemplate(mock(PlatformTransactionManager::class.java) { SimpleTransactionStatus() }),
    )

    private fun pending(id: String, episode: String) =
        PublicationScheduleEntity(id = id, workId = "work", episodeId = episode, ownerId = owner, versionId = "v-$episode", scheduledAt = due)

    private fun queue(vararg rows: PublicationScheduleEntity) {
        `when`(schedules.findTop25ByStatusAndScheduledAtLessThanEqualOrderByScheduledAtAscIdAsc(eq("pending") ?: "pending", any(Instant::class.java) ?: due))
            .thenReturn(rows.toList())
        rows.forEach { `when`(schedules.findById(it.id)).thenReturn(Optional.of(it)) }
    }

    @ParameterizedTest
    @ValueSource(ints = [503, 504])
    fun `temporary Core outage keeps the schedule pending for the next poll`(status: Int) {
        val row = pending("s1", "e2")
        queue(row)
        `when`(auth.verifyScheduledMember(owner)).thenThrow(CoreAuthException(status, "CORE_AUTH_UNAVAILABLE", "down"))
        service.publishDue()
        assertEquals("pending", row.status)
        assertNull(row.failureReason)
        verifyNoInteractions(publication)
    }

    @Test fun `restricted member is recorded as a failed schedule`() {
        val row = pending("s1", "e2")
        queue(row)
        `when`(auth.verifyScheduledMember(owner)).thenThrow(CoreAuthException(401, "UNAUTHORIZED", "restricted"))
        service.publishDue()
        assertEquals("failed", row.status)
        assertEquals("발행 권한을 확인할 수 없는 회원이에요.", row.failureReason)
    }

    @Test fun `schedules due at the same time publish in episode order`() {
        val third = pending("a", "e3")
        val second = pending("b", "e2")
        queue(third, second)
        val rows = listOf(EpisodeEntity(id = "e3", workId = "work", sequence = 3), EpisodeEntity(id = "e2", workId = "work", sequence = 2))
        `when`(episodes.findAllById(listOf("e3", "e2"))).thenReturn(rows)
        rows.forEach { `when`(episodes.findById(it.id)).thenReturn(Optional.of(it)) }
        `when`(auth.verifyScheduledMember(owner)).thenReturn(UUID.fromString(owner))
        service.publishDue()
        val order = inOrder(publication)
        order.verify(publication).publishScheduled("work", owner, 2, "v-e2")
        order.verify(publication).publishScheduled("work", owner, 3, "v-e3")
        assertEquals(listOf("published", "published"), listOf(second.status, third.status))
    }

    @Test fun `concurrent second pending schedule is a conflict, not a server error`() {
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeEntity(id = "e2", workId = "work", sequence = 2))
        `when`(writing.read("work", owner, 2)).thenReturn(
            EpisodeResponse(2, DraftResponse(), listOf(VersionResponse("v1", "제목", "본문", 0, 2, "2026-11-10T00:00:00Z")), null, false, null),
        )
        `when`(schedules.saveAndFlush(any(PublicationScheduleEntity::class.java) ?: pending("x", "e2")))
            .thenThrow(DataIntegrityViolationException("publication_schedule_one_pending"))
        val failure = assertThrows(ContentFailure::class.java) {
            service.create("work", owner, 2, PublicationScheduleRequest("v1", Instant.now().plusSeconds(3600), true))
        }
        assertEquals(409, failure.status)
    }
}
