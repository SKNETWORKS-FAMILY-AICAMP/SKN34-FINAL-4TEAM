package ai.storyfork.core.notification.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import java.util.UUID

/** 회원이 끈/켠 알림 분류. 저장된 행이 없는 분류는 기본값 켜짐이다. */
@Entity
@Table(name = "notification_preference")
@IdClass(NoticePreferenceEntity.Key::class)
class NoticePreferenceEntity(
    @field:Id @field:Column(name = "member_id")
    var memberId: UUID = UUID(0L, 0L),
    @field:Id @field:Column(name = "kind", length = 40)
    var kind: String = "",
    @field:Column(name = "enabled", nullable = false)
    var enabled: Boolean = true,
) {
    data class Key(var memberId: UUID = UUID(0L, 0L), var kind: String = "") : java.io.Serializable
}
