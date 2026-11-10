package ai.storyfork.operations.comment

import ai.storyfork.operations.comment.controller.CommentController
import ai.storyfork.operations.comment.service.CommentService
import ai.storyfork.operations.comment.service.dto.OperationsComment
import ai.storyfork.operations.comment.service.dto.OperationsCommentList
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Spring context나 HTTP 서버 없이 인증 회원 전달과 숨김·복구가 서로 바뀌지 않는지 확인한다. */
class CommentControllerTest {
    private val service = mock(CommentService::class.java)
    private val controller = CommentController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val commentId = "ops-comment-1"
    private val hidden = OperationsComment(
        commentId, "ops-work-1", "작품", 3, "ops-comment-author", "작가", "원문", 2, true, Instant.parse("2026-11-10T01:02:03Z"),
    )

    @Test
    fun `list hide and unhide pass the authenticated member and return the service DTOs`() {
        val list = OperationsCommentList(emptyList())
        `when`(service.list(member)).thenReturn(list)
        `when`(service.hide(member, commentId)).thenReturn(hidden)
        `when`(service.unhide(member, commentId)).thenReturn(hidden.copy(hidden = false))

        assertSame(list, controller.list(member))
        assertEquals(hidden, controller.hide(member, commentId))
        assertEquals(hidden.copy(hidden = false), controller.unhide(member, commentId))
    }
}
