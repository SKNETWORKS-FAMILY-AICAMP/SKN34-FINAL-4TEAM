package ai.storyfork.core.notification.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.util.UUID

@Entity
@Table(name = "notification_push_device")
class PushDevice(
    @Id @Column(name = "installation_id") val installationId: UUID,
    @Column(name = "session_id", nullable = false) var sessionId: UUID,
    @Column(nullable = false, length = 4096) var token: String,
    @Column(name = "endpoint_arn", length = 512) var endpointArn: String? = null,
)
