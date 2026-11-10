package ai.storyfork.content.comment.service.dto

import java.time.Instant

/**
 * 운영 댓글 조회의 댓글 한 건이다. 운영자가 검토할 수 있도록 숨긴 댓글도 원문 [body]를 그대로 담고 [hidden]으로 상태만 알린다.
 * [authorId]는 varchar 그대로 String이다(UUID가 아닐 수 있다).
 */
data class OperationsCommentResponse(
    val commentId: String, val workId: String, val workTitle: String, val episodeNumber: Int,
    val authorId: String, val authorName: String, val body: String, val likeCount: Int, val hidden: Boolean,
    val createdAt: Instant,
)

data class OperationsCommentListResponse(val items: List<OperationsCommentResponse>)
