package ai.storyfork.core.world.service.dto

import jakarta.validation.constraints.*

data class RevisionRequest(@field:Min(0) val revision: Int)
