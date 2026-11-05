package ai.storyfork.core.notification.service.dto

import ai.storyfork.core.notification.domain.NoticeKind
import java.util.UUID

/** 서버 내부(이벤트 소비자 등)에서 알림을 만들 때 쓰는 입력. HTTP로 노출하지 않는다. */
data class NoticeCreateRequest(
    val recipientId: UUID,
    val kind: NoticeKind,
    val summary: String,
    val targetType: String? = null,
    val targetId: String? = null,
)
