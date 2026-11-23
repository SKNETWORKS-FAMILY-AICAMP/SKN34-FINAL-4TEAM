package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.config.OPERATOR_AUTHORITY
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity
import ai.storyfork.content.publication.repository.WorkPublicationHistoryRepository
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import ai.storyfork.content.world.studio.repository.lockAccessible
import jakarta.persistence.EntityManager
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder

/** 운영자는 소유권 없이 모든 작품을 조회(GET·HEAD)만 한다. 저장·발행 등 쓰기 요청은 소유자만이다(사용자 결정 2026-11-23). */
class WorkAccessOperatorTest {
    private val works = mock(WorkRepository::class.java)
    private val worlds = mock(WorkWorldHistoryRepository::class.java)
    private val visibility = mock(WorkPublicationHistoryRepository::class.java)
    private val access = WorkAccessService(works, worlds, visibility, mock(ForkPolicyHistoryRepository::class.java),
        mock(ForkPolicyEpisodeRepository::class.java), mock(ForkRepository::class.java), mock(CheckpointRepository::class.java),
        mock(EpisodeRepository::class.java), mock(EpisodeVersionRepository::class.java), mock(EntityManager::class.java))

    private fun work(deleted: Boolean = false) {
        val row = WorkEntity(id = "w", ownerId = "author", title = "작품")
        if (deleted) row.deletedAt = Instant.parse("2026-11-10T00:00:00Z")
        `when`(works.findById("w")).thenReturn(Optional.of(row))
        `when`(worlds.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(WorkWorldHistoryEntity(workId = "w", worldId = "world"))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(WorkPublicationHistoryEntity(workId = "w", visibility = "private"))
    }

    private fun signIn(member: String, operator: Boolean, method: String = "GET") {
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
            org.springframework.web.context.request.ServletRequestAttributes(org.springframework.mock.web.MockHttpServletRequest(method, "/")))
        val authorities = if (operator) listOf(SimpleGrantedAuthority(OPERATOR_AUTHORITY)) else emptyList()
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(member, null, authorities)
    }

    @AfterEach fun clear() { SecurityContextHolder.clearContext(); org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes() }

    @Test fun `an operator opens another author's private work`() {
        work(); signIn("admin", operator = true)
        assertEquals("w", access.own("w", "admin").id)
    }

    @Test fun `an operator cannot write to another author's work`() {
        work()
        for (method in listOf("POST", "PUT", "PATCH", "DELETE")) {
            signIn("admin", operator = true, method = method)
            assertEquals(404, assertThrows(ContentFailure::class.java) { access.own("w", "admin") }.status)
        }
    }

    @Test fun `a non-operator still gets 404 for another author's work`() {
        work(); signIn("reader", operator = false)
        assertEquals(404, assertThrows(ContentFailure::class.java) { access.own("w", "reader") }.status)
    }

    @Test fun `an operator reads another author's private work through the reader API`() {
        work(); signIn("admin", operator = true)
        assertEquals("w", access.published("w").id)
        signIn("reader", operator = false)
        assertEquals(404, assertThrows(ContentFailure::class.java) { access.published("w") }.status)
    }

    @Test fun `an operator locks another author's world without the owner condition`() {
        val worlds = mock(ai.storyfork.content.world.studio.repository.StudioWorldRepository::class.java)
        val world = java.util.UUID.randomUUID(); val admin = java.util.UUID.randomUUID()
        signIn(admin.toString(), operator = false)
        worlds.lockAccessible(world, admin)
        verify(worlds).lockOwned(world, admin)
        signIn(admin.toString(), operator = true)
        worlds.lockAccessible(world, admin)
        verify(worlds).lockLive(world)
    }

    @Test fun `an operator still gets 404 for a deleted work`() {
        work(deleted = true); signIn("admin", operator = true)
        assertEquals(404, assertThrows(ContentFailure::class.java) { access.own("w", "admin") }.status)
    }
}
