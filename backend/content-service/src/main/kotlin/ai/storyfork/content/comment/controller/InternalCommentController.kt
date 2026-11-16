package ai.storyfork.content.comment.controller

import ai.storyfork.content.comment.service.InternalCommentService
import ai.storyfork.content.comment.service.dto.OperationsCommentListResponse
import ai.storyfork.content.comment.service.dto.OperationsCommentResponse
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 내부 API. `X-Operations-Service-Token`만으로 인증하며 공개 proxy에 등록하지 않는다. */
@RestController
@RequestMapping("/internal/v1/comments")
class InternalCommentController(private val service: InternalCommentService) {
    /** 운영 댓글 조회용 전체 댓글 목록(숨김 포함, 작성 최신순·id순)이다. 삭제된 댓글·삭제된 작품의 댓글은 뺀다. */
    @GetMapping
    fun list(): OperationsCommentListResponse = service.list()

    /** 댓글을 숨긴다(멱등). 공개 응답에서는 자리표시로 바뀐다. 없는·삭제된 댓글은 404다. */
    @PutMapping("/{commentId}/hidden")
    fun hide(@PathVariable commentId: String): OperationsCommentResponse = service.hide(commentId)

    /** 숨긴 댓글을 다시 게시한다(멱등). 없는·삭제된 댓글은 404다. */
    @DeleteMapping("/{commentId}/hidden")
    fun restore(@PathVariable commentId: String): OperationsCommentResponse = service.restore(commentId)
}
