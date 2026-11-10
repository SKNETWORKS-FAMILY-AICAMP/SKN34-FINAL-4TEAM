package ai.storyfork.operations.comment.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.comment.service.dto.OperationsComment
import ai.storyfork.operations.comment.service.dto.OperationsCommentList
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service

private const val COMMENTS = "comments"

/**
 * The `comments` permission is checked before any Content call. No service transaction, so a slow Content call never holds a DB connection.
 * Hide/unhide are recorded in the admin activity log only after Content succeeded; the detail is the work title, never the comment body.
 */
@Service
class CommentService(
    private val content: ContentClient,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember): OperationsCommentList {
        permissions.requirePermission(member, COMMENTS)
        return content.listComments()
    }

    fun hide(member: OperationsMember, commentId: String): OperationsComment {
        permissions.requirePermission(member, COMMENTS)
        return content.hideComment(commentId).also { activities.record(member, "COMMENT_HIDE", "COMMENT", commentId, it.workTitle) }
    }

    fun unhide(member: OperationsMember, commentId: String): OperationsComment {
        permissions.requirePermission(member, COMMENTS)
        return content.unhideComment(commentId).also { activities.record(member, "COMMENT_UNHIDE", "COMMENT", commentId, it.workTitle) }
    }
}
