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
import org.springframework.dao.CannotAcquireLockException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.transaction.CannotCreateTransactionException
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionStatus
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
        // getTransaction만 status를 돌려준다(null이면 executeWithoutResult 람다에서 NPE). void인 commit·rollback에도 돌려주면
        // Mockito가 WrongTypeOfReturnValue를 던져 commit이 깨지고, 롤백 경로에서는 원래 예외를 덮어쓴다.
        TransactionTemplate(mock(PlatformTransactionManager::class.java) { call ->
            if (call.method.returnType == TransactionStatus::class.java) SimpleTransactionStatus() else null
        }),
    )

    private fun pending(id: String, episode: String, work: String = "work") =
        PublicationScheduleEntity(id = id, workId = work, episodeId = episode, ownerId = owner, versionId = "v-$episode", scheduledAt = due)

    private fun queue(vararg rows: PublicationScheduleEntity) {
        `when`(schedules.findDue(eq("pending") ?: "pending", any(Instant::class.java) ?: due, any(Pageable::class.java) ?: PageRequest.of(0, 25)))
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

    @ParameterizedTest
    @ValueSource(strings = ["lock", "connection"])
    fun `temporary database error keeps the schedule pending for the next poll`(kind: String) {
        val row = pending("s1", "e2")
        queue(row)
        `when`(episodes.findById("e2")).thenReturn(Optional.of(EpisodeEntity(id = "e2", workId = "work", sequence = 2)))
        `when`(auth.verifyScheduledMember(owner)).thenReturn(UUID.fromString(owner))
        val error = if (kind == "lock") CannotAcquireLockException("lock timeout") else CannotCreateTransactionException("no connection")
        doThrow(error).`when`(publication).publishScheduled("work", owner, 2, "v-e2")
        service.publishDue()
        assertEquals("pending", row.status)
        assertNull(row.failureReason)
        assertNull(row.completedAt)
    }

    @Test fun `later episodes of a work whose earlier episode was deferred wait for the next poll`() {
        val second = pending("s2", "e2")
        val other = pending("s9", "o1", work = "other")
        val third = pending("s3", "e3")
        queue(second, other, third) // 같은 배치: 2화(보류) → 다른 작품 1화 → 같은 작품 3화
        listOf(
            EpisodeEntity(id = "e2", workId = "work", sequence = 2),
            EpisodeEntity(id = "o1", workId = "other", sequence = 1),
            EpisodeEntity(id = "e3", workId = "work", sequence = 3),
        ).forEach { `when`(episodes.findById(it.id)).thenReturn(Optional.of(it)) }
        doThrow(CannotAcquireLockException("lock timeout")).`when`(publication).publishScheduled("work", owner, 2, "v-e2")
        service.publishDue()
        verify(publication, never()).publishScheduled("work", owner, 3, "v-e3")
        verify(publication).publishScheduled("other", owner, 1, "v-o1")
        assertEquals(listOf("pending", "published", "pending"), listOf(second.status, other.status, third.status))
        assertNull(third.completedAt)
    }

    @Test fun `a schedule canceled after it was picked up is not published`() {
        val row = pending("s1", "e2")
        queue(row)
        row.cancel(0, Instant.now()) // Fork 공개 중단이 같은 작품 잠금 안에서 취소한 예약을 실행 루프가 이미 읽어 둔 경우
        `when`(auth.verifyScheduledMember(owner)).thenReturn(UUID.fromString(owner))
        service.publishDue()
        assertEquals("canceled", row.status)
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

    @Test fun `schedules run in the order the repository returns them`() {
        val third = pending("a", "e3")
        val second = pending("b", "e2")
        queue(second, third) // 쿼리가 (예약 시각, 회차 번호, id) 순으로 정렬해 25건까지 돌려준 순서. id만 보면 3화가 앞선다.
        val rows = listOf(EpisodeEntity(id = "e2", workId = "work", sequence = 2), EpisodeEntity(id = "e3", workId = "work", sequence = 3))
        rows.forEach { `when`(episodes.findById(it.id)).thenReturn(Optional.of(it)) }
        `when`(auth.verifyScheduledMember(owner)).thenReturn(UUID.fromString(owner))
        service.publishDue()
        verify(schedules).findDue(eq("pending") ?: "pending", any(Instant::class.java) ?: due, eq(PageRequest.of(0, 25)) ?: PageRequest.of(0, 25))
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
