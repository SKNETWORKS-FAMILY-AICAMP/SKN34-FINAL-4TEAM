package ai.storyfork.core.context.service.dto

import jakarta.validation.constraints.*

data class ContextRequest(@field:Min(1) val episode: Int? = null, val query: String = "", val character: String = "")
