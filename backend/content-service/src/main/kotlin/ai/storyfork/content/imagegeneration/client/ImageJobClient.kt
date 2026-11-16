package ai.storyfork.content.imagegeneration.client
import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.imagegeneration.service.dto.ImageDispatch
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient

/** AI 서비스가 Celery 메시지를 구성한다. Content는 작업 ID만 보낸다. */
@Component
class ImageJobClient(builder:RestClient.Builder, props:AiServiceClientProperties, @Value("\${INTERNAL_TOKEN:}") private val token:String) {
 private val http=buildRestClient(builder.clone(),props.baseUrl,props.connectTimeout,props.readTimeout)
 fun submit(id:UUID) { http.post().uri("/internal/v1/images/jobs").header("X-Internal-Token",token)
  .body(ImageDispatch(id)).retrieve().toBodilessEntity() }
}
