package ai.storyfork.operations.comment.controller

import ai.storyfork.operations.comment.service.CommentService
import ai.storyfork.operations.security.OperationsMember
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/operations/comments")
class CommentController(private val service: CommentService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember) = service.list(member)

    @PutMapping("/{commentId}/hidden")
    fun hide(@AuthenticationPrincipal member: OperationsMember, @PathVariable commentId: String) = service.hide(member, commentId)

    @DeleteMapping("/{commentId}/hidden")
    fun unhide(@AuthenticationPrincipal member: OperationsMember, @PathVariable commentId: String) = service.unhide(member, commentId)
}
