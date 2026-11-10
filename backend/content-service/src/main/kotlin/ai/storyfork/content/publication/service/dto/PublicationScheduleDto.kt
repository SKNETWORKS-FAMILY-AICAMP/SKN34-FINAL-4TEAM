package ai.storyfork.content.publication.service.dto

import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant

data class PublicationScheduleRequest(
    @field:NotBlank @field:Size(max = 200) val versionId: String,
    val scheduledAt: Instant,
    val rightsConfirmed: Boolean,
    @field:Min(0) val revision: Int? = null,
)

data class PublicationScheduleResponse(
    val id: String,
    val versionId: String,
    val scheduledAt: String,
    val status: String,
    val revision: Int,
    val completedAt: String?,
    val failureReason: String?,
)
