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
    /** 사건에서 만든 알림이면 사건 id. 같은 사건의 재전달을 한 번만 반영하는 키다. */
    val sourceEventId: UUID? = null,
    /** 회차 단위 사건의 회차 번호(#941). 알림을 누르면 그 회차로 간다. */
    val targetEpisode: Int? = null,
    /** ai-tool 묶음 요약("<대상> 외 n건")에 다시 쓸 대상 구절(#941). 없으면 묶을 때 문구를 바꾸지 않는다. */
    val bundleSubject: String? = null,
)
