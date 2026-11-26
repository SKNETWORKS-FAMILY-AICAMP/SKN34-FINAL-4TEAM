package ai.storyfork.content.comment.controller

import ai.storyfork.content.comment.service.CommentFeedbackQueryService
import ai.storyfork.content.comment.service.dto.CommentFeedbackResult
import java.security.Principal
import org.springframework.web.bind.annotation.*

@RestController
class CommentFeedbackController(private val feedback: CommentFeedbackQueryService) {
    @GetMapping("/api/v1/works/{id}/comment-feedback")
    fun inbox(@PathVariable id: String, @RequestParam episode: Int?,
              @RequestParam(defaultValue = "0") offset: Int, @RequestParam(defaultValue = "20") size: Int,
              principal: Principal) = feedback.inbox(id, episode, offset, size, principal.name)

    /** 작품 소유자와 읽기가 허용된 운영자에게 현재 댓글의 분석 상태를 반환한다. */
    @GetMapping("/api/v1/works/{id}/episodes/{number}/comments/{commentId}/feedback-analysis")
    fun read(@PathVariable id: String,@PathVariable number: Int,@PathVariable commentId: String,
             principal: Principal): CommentFeedbackResult = feedback.read(id,number,commentId,principal.name)

    @GetMapping("/api/v1/works/{id}/comment-feedback/counts")
    fun counts(@PathVariable id: String, @RequestParam episode: Int?, principal: Principal) =
        feedback.counts(id,episode,principal.name)

    @PostMapping("/api/v1/works/{id}/episodes/{number}/comments/{commentId}/feedback-analysis/retry")
    @ResponseStatus(org.springframework.http.HttpStatus.ACCEPTED)
    fun retry(@PathVariable id: String,@PathVariable number: Int,@PathVariable commentId: String,
              principal: Principal) = feedback.retry(id,number,commentId,principal.name)
}
