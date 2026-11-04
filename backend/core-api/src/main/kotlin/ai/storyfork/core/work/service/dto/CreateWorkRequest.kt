package ai.storyfork.core.work.service.dto

import jakarta.validation.constraints.*

data class CreateWorkRequest(@field:NotBlank @field:Size(max=120) val title: String, @field:Size(max=2000) val summary: String = "")
