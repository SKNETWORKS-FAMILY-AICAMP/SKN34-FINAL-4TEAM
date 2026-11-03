package ai.storyfork.core.publication.service.dto

import jakarta.validation.constraints.*

data class PublishRequest(@field:Min(0) val revision: Int, val rightsConfirmed: Boolean, val allowFork: Boolean = false, val allowForkPublication: Boolean = false, val versionId: String? = null)
