package ai.storyfork.content.proposal.service.dto

import jakarta.validation.constraints.*

data class ProposalRequest(@field:Min(0) val revision: Int, @field:NotBlank @field:Size(max=2000) val prompt: String, val consent: Boolean, @field:Min(1) val episode: Int? = null, @field:Size(max=80) val character: String = "")
