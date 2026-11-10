package ai.storyfork.operations.comment

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.comment.service.CommentService
import ai.storyfork.operations.comment.service.dto.OperationsComment
import ai.storyfork.operations.comment.service.dto.OperationsCommentList
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked Content client and repository: no Spring context, HTTP or database. */
class CommentServiceTest {
    private val content = mock(ContentClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val service = CommentService(content, permissions)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutComments = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val commentId = "ops-comment-1"
    private val comment = OperationsComment(
        commentId, "ops-work-1", "작품", 3, "ops-comment-author", "작가", "원문", 2, false, Instant.parse("2026-11-10T01:02:03Z"),
    )

    private fun grantComments(vararg members: OperationsMember) = members.forEach {
        `when`(permissions.existsByMemberIdAndPermission(it.memberId, "comments")).thenReturn(true)
    }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    @Test
    fun `list returns the Content list as is for an operator with comments permission`() {
        grantComments(admin)
        val list = OperationsCommentList(listOf(comment))
        `when`(content.listComments()).thenReturn(list)

        assertSame(list, service.list(admin))
    }

    @Test
    fun `hide and unhide delegate to Content with the comment id and return its comment`() {
        grantComments(admin)
        `when`(content.hideComment(commentId)).thenReturn(comment.copy(hidden = true))
        `when`(content.unhideComment(commentId)).thenReturn(comment)

        assertTrue(service.hide(admin, commentId).hidden)
        assertFalse(service.unhide(admin, commentId).hidden)
    }

    @Test
    fun `an operator without comments permission or a stale grant without operator is denied before Content`() {
        grantComments(staleGrant)
        for (member in listOf(operatorWithoutComments, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.list(member) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.hide(member, commentId) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.unhide(member, commentId) })
        }
        verifyNoInteractions(content)
    }

    @Test
    fun `Content failures reach the caller instead of an empty or successful result`() {
        grantComments(admin)
        `when`(content.listComments()).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.hideComment(commentId)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(content.unhideComment(commentId)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))

        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.hide(admin, commentId) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.unhide(admin, commentId) })
    }
}
