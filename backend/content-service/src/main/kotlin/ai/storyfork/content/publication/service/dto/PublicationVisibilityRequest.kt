package ai.storyfork.content.publication.service.dto

import jakarta.validation.constraints.Min

data class PublicationVisibilityRequest(@field:Min(0) val revision: Int, val visible: Boolean, val rightsConfirmed: Boolean = false)
