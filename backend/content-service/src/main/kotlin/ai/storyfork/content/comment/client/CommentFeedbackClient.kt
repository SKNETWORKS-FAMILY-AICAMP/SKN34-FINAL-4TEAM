package ai.storyfork.content.comment.client

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.comment.client.dto.*
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient

@Component
class CommentFeedbackClient(builder: RestClient.Builder, props: AiServiceClientProperties,
    @Value("\${INTERNAL_TOKEN:}") private val token: String) {
    private val http = buildRestClient(builder.clone(), props.baseUrl, props.connectTimeout, props.readTimeout)
    // 리스는 HTTP 요청의 연결 및 응답 시간 제한보다 길어야 한다.
    val leaseSeconds = (props.connectTimeout + props.readTimeout).seconds + 60

    fun classify(body: String): FeedbackPrediction =
        checkNotNull(http.post().uri("/internal/v1/comments/feedback").header("X-Internal-Token", token)
            .body(FeedbackInput(body)).retrieve().body(FeedbackPrediction::class.java)?.takeIf { it.valid() })

    fun classifyBatch(items: Map<String,String>): Map<String,FeedbackPrediction> {
        val input = items.map { (id,text) -> mapOf("id" to id, "text" to text) }
        val rows = checkNotNull(http.post().uri("/internal/v1/comments/feedback/batch").header("X-Internal-Token", token)
            .body(mapOf("items" to input)).retrieve().body(Array<FeedbackPrediction>::class.java))
        val results = rows.associateBy { checkNotNull(it.id) }
        check(rows.size == items.size && results.keys == items.keys && rows.all {
            it.valid() && !it.aspectVersion.isNullOrBlank() &&
                (if (it.isFeedback == true) it.primaryAspect in primaryClasses else it.primaryAspect == null)
        })
        return results
    }
}
