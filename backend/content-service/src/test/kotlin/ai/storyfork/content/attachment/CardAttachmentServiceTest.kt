package ai.storyfork.content.attachment

import ai.storyfork.content.attachment.controller.AttachmentExceptionHandler
import ai.storyfork.content.attachment.controller.CardAttachmentController
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.attachment.service.CardAttachmentService
import ai.storyfork.content.attachment.service.dto.AttachmentListResponse
import ai.storyfork.content.attachment.service.dto.AttachmentRenameRequest
import ai.storyfork.content.attachment.service.dto.AttachmentUploadPayload
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.WorldStudioService
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.web.bind.annotation.RestControllerAdvice

/**
 * 세계관 카드 첨부(#735)의 접근 규칙이다. 세계관 소유자의 지우지 않은 카드만 지나가고, 그 밖은 첨부 로직·객체 저장소에 닿기 전에 404다.
 * 첨부 로직 자체(목록·업로드·교체·삭제)는 AttachmentServiceTest가 card = true로 확인한다.
 */
class CardAttachmentServiceTest {
    private val worlds = mock(WorldStudioService::class.java)
    private val attachments = mock(AttachmentService::class.java)
    private val service = CardAttachmentService(worlds, attachments)
    private val world = UUID.randomUUID()
    private val card = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val payload = AttachmentUploadPayload("note.txt", "text/plain", "FILE", "참고".toByteArray())

    /** 카드 첨부의 모든 동작이다. 어느 하나라도 접근 확인을 건너뛰면 아래 테스트가 잡는다. */
    private val operations: Map<String, (String, String, String) -> Any?> = mapOf(
        "upload access" to { w, c, o -> service.requireUploadAccess(w, c, o) },
        "list" to { w, c, o -> service.list(w, c, o) },
        "read" to { w, c, o -> service.read(w, c, "attachment", o) },
        "download" to { w, c, o -> service.download(w, c, "attachment", o) },
        "create" to { w, c, o -> service.create(w, c, o, payload) },
        "replace" to { w, c, o -> service.replace(w, c, "attachment", o, payload) },
        "rename" to { w, c, o -> service.rename(w, c, "attachment", o, AttachmentRenameRequest("new.txt")) },
        "delete" to { w, c, o -> service.delete(w, c, "attachment", o) },
    )

    @Test fun `the card is checked first and then the shared attachment logic runs for that card`() {
        `when`(worlds.hasCard(world, owner, card)).thenReturn(true)
        `when`(attachments.listSettingAttachments("${world}", "${card}", "${owner}", true)).thenReturn(AttachmentListResponse(emptyList()))
        assertEquals(AttachmentListResponse(emptyList()), service.list("${world}", "${card}", "${owner}"))
        val ordered = inOrder(worlds, attachments)
        ordered.verify(worlds).hasCard(world, owner, card)
        ordered.verify(attachments).listSettingAttachments("${world}", "${card}", "${owner}", true)
    }

    @Test fun `every operation is a 404 for a removed card another world's card or a stranger's world before any attachment work`() {
        for (missing in listOf<() -> Unit>({ `when`(worlds.hasCard(world, owner, card)).thenReturn(false) }, { `when`(worlds.hasCard(world, owner, card)).thenThrow(WorldNotFound()) })) {
            reset(worlds); missing()
            for ((name, run) in operations) {
                val failure = assertThrows(AttachmentFailure::class.java, { run("${world}", "${card}", "${owner}") }, name)
                assertEquals(404, failure.status, name)
                assertEquals("ATTACHMENT_NOT_FOUND", failure.code, name)
            }
        }
        verifyNoInteractions(attachments)
    }

    @Test fun `malformed ids are a 404 and a missing member is a 401 without reading the world`() {
        for ((name, run) in operations) {
            assertEquals("ATTACHMENT_NOT_FOUND", assertThrows(AttachmentFailure::class.java, { run("not-a-uuid", "${card}", "${owner}") }, name).code, name)
            assertEquals("ATTACHMENT_NOT_FOUND", assertThrows(AttachmentFailure::class.java, { run("${world}", "not-a-uuid", "${owner}") }, name).code, name)
            assertEquals("ATTACHMENT_UNAUTHENTICATED", assertThrows(AttachmentFailure::class.java, { run("${world}", "${card}", "") }, name).code, name)
        }
        verifyNoInteractions(worlds, attachments)
    }

    @Test fun `a world database failure is reported as a database failure instead of a missing card`() {
        `when`(worlds.hasCard(world, owner, card)).thenThrow(DataAccessResourceFailureException("private SQL"))
        val failure = assertThrows(AttachmentFailure::class.java) { service.list("${world}", "${card}", "${owner}") }
        assertEquals(503, failure.status)
        assertEquals("ATTACHMENT_DATABASE_FAILURE", failure.code)
        verifyNoInteractions(attachments)
    }

    @Test fun `the attachment error handler also covers the card controller`() {
        val advice = AttachmentExceptionHandler::class.java.getAnnotation(RestControllerAdvice::class.java)
        assertTrue(advice.assignableTypes.any { it.java == CardAttachmentController::class.java })
    }
}
