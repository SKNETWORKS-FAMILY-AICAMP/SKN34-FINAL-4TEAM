package ai.storyfork.core.proposal.client.dto
import ai.storyfork.core.proposal.service.dto.UsageResponse

data class GenerationResponse(val text: String, val model: String, val providerResponseId: String? = null, val usage: UsageResponse? = null)
