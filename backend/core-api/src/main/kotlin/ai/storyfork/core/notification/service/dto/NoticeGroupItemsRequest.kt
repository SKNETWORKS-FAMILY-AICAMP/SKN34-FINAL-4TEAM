package ai.storyfork.core.notification.service.dto

import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

/** 한 묶음에 속한 개별 알림 조회 쿼리. 묶음 응답의 kind·targetType·targetId를 그대로 전달한다. */
data class NoticeGroupItemsRequest(
    @field:NotBlank @field:Size(max = 40) val kind: String? = null,
    @field:NotBlank @field:Size(max = 40) val targetType: String? = null,
    @field:NotBlank @field:Size(max = 100) val targetId: String? = null,
    @field:Min(1) @field:Max(50) val limit: Int = 20,
)
