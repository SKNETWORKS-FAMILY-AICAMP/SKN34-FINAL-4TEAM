package ai.storyfork.core.notification.service.dto

import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min

/** 묶음 알림 목록 조회 쿼리. 1차는 페이지 넘김 없이 최근 묶음을 limit개까지만 반환한다. */
data class NoticeGroupListRequest(
    @field:Min(1) @field:Max(50) val limit: Int = 20,
)
