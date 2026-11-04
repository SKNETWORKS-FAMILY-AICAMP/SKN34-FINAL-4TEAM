package ai.storyfork.core.work.service.dto

import jakarta.validation.constraints.*

data class PolicyRequest(@field:Min(0) val revision: Int, val allowFork: Boolean, val allowForkPublication: Boolean)
