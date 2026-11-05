package ai.storyfork.core.notification.service.dto

import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min

/** 알림 목록 조회 쿼리. cursor는 직전 응답의 nextCursor를 그대로 전달한다. */
data class NoticeListRequest(
    val cursor: String? = null,
    @field:Min(1) @field:Max(50) val limit: Int = 20,
)
