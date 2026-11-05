package ai.storyfork.core.notification.service.dto

import jakarta.validation.Valid
import jakarta.validation.constraints.Size

data class NoticePreferencesRequest(@field:Valid @field:Size(min = 1, max = 10) val items: List<NoticePreferenceItem> = emptyList())
