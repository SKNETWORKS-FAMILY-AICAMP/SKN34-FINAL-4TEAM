package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.entity.PushDevice
import ai.storyfork.core.notification.service.PushDeviceService
import ai.storyfork.core.notification.service.SnsPushDelivery
import ai.storyfork.core.notification.service.StoredPushNotice
import java.util.UUID
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.core.task.SyncTaskExecutor
import software.amazon.awssdk.services.sns.SnsClient
import software.amazon.awssdk.services.sns.model.CreatePlatformEndpointRequest
import software.amazon.awssdk.services.sns.model.CreatePlatformEndpointResponse
import software.amazon.awssdk.services.sns.model.GetEndpointAttributesRequest
import software.amazon.awssdk.services.sns.model.GetEndpointAttributesResponse
import software.amazon.awssdk.services.sns.model.PublishRequest
import software.amazon.awssdk.services.sns.model.SetEndpointAttributesRequest
import tools.jackson.databind.json.JsonMapper

class SnsPushDeliveryTest {
    private val sns = mock(SnsClient::class.java)
    private val devices = mock(PushDeviceService::class.java)
    private val platform = "arn:aws:sns:ap-northeast-2:000000000000:app/GCM/storyfork-test"
    private val endpoint = "arn:aws:sns:ap-northeast-2:000000000000:endpoint/GCM/storyfork-test/device"
    private val device = PushDevice(UUID.randomUUID(), UUID.randomUUID(), "latest-device-token")
    private val notice = StoredPushNotice(UUID.randomUUID(), NoticeKind.CREDIT, UUID.randomUUID().toString(), "크레딧")
    private val delivery = SnsPushDelivery(sns, devices, JsonMapper.builder().build(), SyncTaskExecutor(), platform)

    @Test
    fun `최신 토큰을 재등록하면 기존 비활성 SNS 엔드포인트를 복구하고 발송한다`() {
        `when`(devices.recipients(notice.memberId, notice.kind)).thenReturn(listOf(device))
        `when`(devices.saveEndpoint(device, endpoint)).thenReturn(true)
        `when`(devices.isActive(device)).thenReturn(true)
        `when`(sns.createPlatformEndpoint(CreatePlatformEndpointRequest.builder().platformApplicationArn(platform).token(device.token).build()))
            .thenReturn(CreatePlatformEndpointResponse.builder().endpointArn(endpoint).build())
        `when`(sns.getEndpointAttributes(GetEndpointAttributesRequest.builder().endpointArn(endpoint).build()))
            .thenReturn(GetEndpointAttributesResponse.builder().attributes(mapOf("Token" to device.token, "Enabled" to "false")).build())

        delivery.afterCommit(notice)

        val order = inOrder(sns)
        order.verify(sns).setEndpointAttributes(SetEndpointAttributesRequest.builder()
            .endpointArn(endpoint).attributes(mapOf("Token" to device.token, "Enabled" to "true")).build())
        order.verify(sns).publish(any(PublishRequest::class.java))
    }
}
