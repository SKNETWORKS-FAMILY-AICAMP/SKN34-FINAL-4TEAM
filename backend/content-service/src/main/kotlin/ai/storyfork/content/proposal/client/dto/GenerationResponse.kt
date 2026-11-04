package ai.storyfork.content.proposal.client.dto
import ai.storyfork.content.proposal.service.dto.UsageResponse

data class GenerationResponse(val text: String, val model: String, val providerResponseId: String? = null, val usage: UsageResponse? = null)
