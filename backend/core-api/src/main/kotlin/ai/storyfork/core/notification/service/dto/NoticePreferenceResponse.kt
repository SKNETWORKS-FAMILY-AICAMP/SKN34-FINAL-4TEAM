package ai.storyfork.core.notification.service.dto

/** mutable=false인 분류(처리 결과·크레딧·권리·보안)는 항상 enabled=true이며 끌 수 없다. */
data class NoticePreferenceResponse(val kind: String, val enabled: Boolean, val mutable: Boolean)
