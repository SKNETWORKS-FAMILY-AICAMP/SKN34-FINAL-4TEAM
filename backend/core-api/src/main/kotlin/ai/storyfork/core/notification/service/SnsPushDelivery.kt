package ai.storyfork.core.notification.service

import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.entity.PushDevice
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.core.task.TaskExecutor
import org.springframework.core.task.TaskRejectedException
import org.springframework.stereotype.Component
import org.springframework.transaction.event.TransactionalEventListener
import software.amazon.awssdk.services.sns.SnsClient
import software.amazon.awssdk.services.sns.model.CreatePlatformEndpointRequest
import software.amazon.awssdk.services.sns.model.EndpointDisabledException
import software.amazon.awssdk.services.sns.model.GetEndpointAttributesRequest
import software.amazon.awssdk.services.sns.model.NotFoundException
import software.amazon.awssdk.services.sns.model.PublishRequest
import software.amazon.awssdk.services.sns.model.SetEndpointAttributesRequest
import tools.jackson.databind.json.JsonMapper

data class StoredPushNotice(val memberId: UUID, val kind: NoticeKind, val noticeId: String, val summary: String)

/** 커밋된 알림의 Android OS 전달을 시도한다. 알림함과 SSE는 발송 결과에 영향을 받지 않는다. */
@Component
@ConditionalOnProperty(name = ["app.notification.push.enabled"], havingValue = "true")
class SnsPushDelivery(
    private val sns: SnsClient,
    private val devices: PushDeviceService,
    private val mapper: JsonMapper,
    @Qualifier("applicationTaskExecutor") private val executor: TaskExecutor,
    @Value("\${app.notification.push.platform-arn}") private val platformArn: String,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @TransactionalEventListener
    fun afterCommit(notice: StoredPushNotice) {
        try {
            executor.execute {
                try {
                    val message = fcmMessage(notice)
                    devices.recipients(notice.memberId, notice.kind).forEach { send(it, notice.noticeId, message) }
                } catch (e: RuntimeException) {
                    log.warn("Android 푸시 대상 조회 실패 notice={} reason={}", notice.noticeId, e.javaClass.simpleName)
                }
            }
        } catch (_: TaskRejectedException) {
            log.warn("Android 푸시 작업 접수 실패 notice={}", notice.noticeId)
        }
    }

    private fun fcmMessage(notice: StoredPushNotice): String {
        val fcm = mapper.createObjectNode()
        val message = fcm.putObject("fcmV1Message").putObject("message")
        message.putObject("notification").put("title", "STORYFORK").put("body", notice.summary)
        message.putObject("data").put("noticeId", notice.noticeId)
        message.putObject("android").putObject("notification").put("channel_id", "storyfork")
        return mapper.createObjectNode().put("default", notice.summary)
            .put("GCM", mapper.writeValueAsString(fcm)).toString()
    }

    private fun send(device: PushDevice, noticeId: String, message: String) {
        try {
            val endpoint = device.endpointArn ?: registerEndpoint(device) ?: return
            if (!devices.isActive(device)) return
            sns.publish(PublishRequest.builder().targetArn(endpoint).messageStructure("json").message(message).build())
        } catch (_: EndpointDisabledException) {
            devices.removeInvalid(device)
            log.info("Android 푸시 비활성 토큰 해제 notice={}", noticeId)
        } catch (_: NotFoundException) {
            devices.saveEndpoint(device, null)
            log.warn("Android SNS 엔드포인트 없음 notice={}", noticeId)
        } catch (e: RuntimeException) {
            log.warn("Android 푸시 발송 실패 notice={} reason={}", noticeId, e.javaClass.simpleName)
        }
    }

    private fun registerEndpoint(device: PushDevice): String? {
        if (!devices.isActive(device)) return null
        val endpoint = sns.createPlatformEndpoint(CreatePlatformEndpointRequest.builder()
            .platformApplicationArn(platformArn).token(device.token).build()).endpointArn()
        val attributes = sns.getEndpointAttributes(GetEndpointAttributesRequest.builder().endpointArn(endpoint).build()).attributes()
        if (attributes["Token"] != device.token || !attributes["Enabled"].equals("true", ignoreCase = true)) {
            sns.setEndpointAttributes(SetEndpointAttributesRequest.builder().endpointArn(endpoint)
                .attributes(mapOf("Token" to device.token, "Enabled" to "true")).build())
        }
        return endpoint.takeIf { devices.saveEndpoint(device, it) }
    }
}
