package ai.storyfork.content.comment.service.dto

data class CommentFeedbackResult(val commentId: String, val revision: Long, val status: String,
    val isFeedback: Boolean?, val feedbackProbability: Double?, val modelVersion: String?,
    val threshold: Double?, val failure: String?, val primaryAspect: String?, val aspectVersion: String?)
