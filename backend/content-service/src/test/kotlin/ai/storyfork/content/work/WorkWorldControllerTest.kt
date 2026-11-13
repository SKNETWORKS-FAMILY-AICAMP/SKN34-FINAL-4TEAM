package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content.work.controller.WorkWorldController
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkWorldLinkRequest
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.controller.WorldStudioController
import ai.storyfork.content.world.service.WorldCoverService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CreateWorldRequest
import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import ai.storyfork.content.world.service.dto.WorldStudioSummaryResponse
import java.security.Principal
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestControllerAdvice

/** 세계관-소설 연결(DEC-46)의 HTTP 조립: 연결·독자 위키 경로와, 세계관 소유자 응답에 연결된 작품을 붙이는 일이다. 서비스는 대역이다. */
class WorkWorldControllerTest {
    private val links = mock(WorkWorldService::class.java)
    private val studio = mock(WorldStudioService::class.java)
    private val works = WorkWorldController(links)
    private val studios = WorldStudioController(studio, mock(WorldCoverService::class.java), links)
    private val owner = UUID.randomUUID()
    private val principal = Principal { owner.toString() }
    private val world = UUID.randomUUID()
    private fun draft(id: UUID = world, revision: Long = 1) = WorldDraftResponse(id, revision, null, null, "세계관", "", emptyList(), emptyList())

    @Test fun `link and unlink hand the signed-in member and the body's world to the service, and reader cards pass upto as sent`() {
        `when`(links.link("work", owner.toString(), world)).thenReturn(WorkWorldLinkResponse("work", world))
        `when`(links.link("work", owner.toString(), null)).thenReturn(WorkWorldLinkResponse("work", null))
        val cards = ReaderWorldCardsResponse("work", world, 3)
        `when`(links.readerCards("work", "3")).thenReturn(cards)

        assertEquals(WorkWorldLinkResponse("work", world), works.link("work", principal, WorkWorldLinkRequest(world)))
        assertEquals(WorkWorldLinkResponse("work", null), works.link("work", principal, WorkWorldLinkRequest()))
        assertSame(cards, works.readerCards("work", "3"))
    }

    @Test fun `routes are the contract paths in the package the content error handler covers`() {
        fun method(name: String) = WorkWorldController::class.java.methods.first { it.name == name }
        assertEquals(listOf("/api/v1"), AnnotatedElementUtils.findMergedAnnotation(WorkWorldController::class.java, RequestMapping::class.java)!!.value.toList())
        assertEquals(listOf("/works/{id}/world-studio"), AnnotatedElementUtils.findMergedAnnotation(method("link"), PutMapping::class.java)!!.value.toList())
        assertEquals(listOf("/public/works/{id}/world-cards"), AnnotatedElementUtils.findMergedAnnotation(method("readerCards"), GetMapping::class.java)!!.value.toList())
        // 404·409(WORLD_ALREADY_LINKED)·422가 500이 아니라 {detail, code} JSON으로 나가려면 이 패키지여야 한다.
        assertTrue(WorkWorldController::class.java.packageName in AnnotatedElementUtils.findMergedAnnotation(ContentExceptionHandler::class.java, RestControllerAdvice::class.java)!!.basePackages)
    }

    @Test fun `the owner's world list tells which work each world is linked to with one lookup`() {
        val unlinked = UUID.randomUUID()
        `when`(studio.list(owner)).thenReturn(listOf(
            WorldStudioSummaryResponse(world, "연결한 세계관", "", 2, "current"), WorldStudioSummaryResponse(unlinked, "연결 없는 세계관", "", 0, "current")))
        `when`(links.linkedWorkIds(listOf(world, unlinked))).thenReturn(mapOf(world to "work"))

        val listed = studios.list(principal)

        assertEquals(listOf("work", null), listed.map { it.linkedWorkId })
        assertEquals(listOf("연결한 세계관", "연결 없는 세계관"), listed.map { it.name })
        verify(links, times(1)).linkedWorkIds(listOf(world, unlinked))
    }

    @Test fun `every draft response of the owner carries the linked work, also right after a save`() {
        val create = CreateWorldRequest("세계관", "", world)
        val edit = EditWorldDraftRequest(1, "세계관", "", key = "save")
        `when`(studio.create(owner, create)).thenReturn(draft(revision = 0))
        `when`(studio.draft(world, owner)).thenReturn(draft())
        `when`(studio.edit(world, owner, edit)).thenReturn(draft(revision = 2))
        `when`(links.linkedWorkIds(listOf(world))).thenReturn(mapOf(world to "work"))

        assertEquals(draft(revision = 0).copy(linkedWorkId = "work"), studios.create(principal, create))
        assertEquals(draft().copy(linkedWorkId = "work"), studios.read(world, principal))
        assertEquals(draft(revision = 2).copy(linkedWorkId = "work"), studios.edit(world, principal, edit))

        // 연결이 없는 세계관은 null이다.
        val other = UUID.randomUUID()
        `when`(studio.draft(other, owner)).thenReturn(draft(other))
        assertNull(studios.read(other, principal).linkedWorkId)
    }
}
