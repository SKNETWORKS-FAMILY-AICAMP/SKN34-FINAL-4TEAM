package ai.storyfork.core.notification.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull

data class NoticePreferenceItem(@field:NotBlank val kind: String?, @field:NotNull val enabled: Boolean?)
