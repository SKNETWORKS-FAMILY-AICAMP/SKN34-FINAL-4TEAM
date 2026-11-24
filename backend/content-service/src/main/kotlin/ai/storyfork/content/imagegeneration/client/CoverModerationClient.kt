package ai.storyfork.content.imagegeneration.client

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.attachment.domain.AttachmentFailure
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException

/** AI 검사 판정만 받아 표지 저장 여부를 Content가 결정한다. */
@Component
class CoverModerationClient(
    builder: RestClient.Builder,
    props: AiServiceClientProperties,
    @Value("\${INTERNAL_TOKEN:}") private val token: String,
) {
    private val http = buildRestClient(
        builder.clone(),
        props.baseUrl,
        props.connectTimeout,
        Duration.ofSeconds(35),
        forwardUser = true,
    )

    fun check(bytes: ByteArray, mediaType: String) {
        val status = try {
            http.post().uri("/internal/v1/images/cover-moderation")
                .header("X-Internal-Token", token)
                .contentType(MediaType.parseMediaType(mediaType))
                .body(bytes)
                .exchange { _, response -> response.statusCode.value() }
        } catch (_: RestClientException) {
            unavailable()
        }
        when (status) {
            204 -> Unit
            400, 413 -> throw AttachmentFailure(422, "COVER_FILE_INVALID", "열 수 있는 정지 이미지로 다시 올려 주세요.")
            422 -> throw AttachmentFailure(422, "COVER_CONTENT_BLOCKED", "표지 이미지가 콘텐츠 정책을 충족하지 않아요. 다른 이미지를 선택해 주세요.")
            else -> unavailable()
        }
    }

    private fun unavailable(): Nothing =
        throw AttachmentFailure(503, "COVER_MODERATION_UNAVAILABLE", "지금은 표지 이미지를 검사할 수 없어요. 잠시 후 다시 시도해 주세요.")
}
