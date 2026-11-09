package ai.storyfork.content.proposal.service.dto

import jakarta.validation.Valid
import jakarta.validation.constraints.*

data class AiRunRequest(
    @field:Size(max=36) val threadId: String? = null,
    val operation: String,
    @field:Size(max=2000) val prompt: String = "",
    @field:Valid val target: AiRunTarget,
    @field:Valid val options: AiRunOptions = AiRunOptions(),
)

data class AiRunTarget(@field:Min(1) val basisEpisode: Int,
    @field:Size(max=36) val forkId: String? = null, @field:Size(max=80) val character: String = "",
    @field:Min(0) val baseRevision: Int)

data class AiRunOptions(@field:Valid val modelConsent: ModelConsent? = null)

data class ModelConsent(val providers: List<String>, val purpose: String,
    @field:Min(1) @field:Max(20) val maxCalls: Int, @field:NotBlank @field:Size(max=80) val noticeVersion: String)
