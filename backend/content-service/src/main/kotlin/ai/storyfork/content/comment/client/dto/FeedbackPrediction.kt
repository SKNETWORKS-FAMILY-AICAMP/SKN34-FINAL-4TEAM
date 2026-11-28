package ai.storyfork.content.comment.client.dto

data class FeedbackInput(val text: String)

/** 외부 응답의 필수 필드 누락을 false나 0으로 해석하지 않는다. */
data class FeedbackPrediction(val isFeedback: Boolean?, val feedbackProbability: Double?,
                              val modelVersion: String?, val threshold: Double?, val id: String? = null,
                              val primaryAspect: String? = null, val aspectVersion: String? = null) {
    fun valid(): Boolean = feedbackProbability != null && feedbackProbability in 0.0..1.0 &&
        threshold != null && threshold in 0.0..1.0 && !modelVersion.isNullOrBlank() &&
        isFeedback == (feedbackProbability > threshold)
}


val primaryClasses = setOf("plot","logic","character","style","typo","schedule","overall_work","other")
