package ai.storyfork.core.auth.service.dto

import java.time.Instant

data class SessionResponse(val id: String, val deviceLabel: String, val createdAt: Instant, val current: Boolean)
