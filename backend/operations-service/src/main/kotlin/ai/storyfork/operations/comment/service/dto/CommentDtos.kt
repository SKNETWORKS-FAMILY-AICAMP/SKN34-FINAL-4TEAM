package ai.storyfork.operations.comment.service.dto

import java.time.Instant

/**
 * Content `OperationsComment`: Content computes every value, so the row is passed through untouched.
 * Every id stays a String because Content `episode_comment.id`·`author_id` are varchars: one non-UUID value must not fail the whole list.
 */
data class OperationsComment(
    val commentId: String,
    val workId: String,
    val workTitle: String,
    val episodeNumber: Int,
    val authorId: String,
    val authorName: String,
    val body: String,
    val likeCount: Int,
    val hidden: Boolean,
    val createdAt: Instant,
)

data class OperationsCommentList(val items: List<OperationsComment>)
