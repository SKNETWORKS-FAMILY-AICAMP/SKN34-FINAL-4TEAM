package ai.storyfork.core.proposal.client.dto
import ai.storyfork.core.context.service.dto.StoryContextResponse

data class GenerationPayload(val context: StoryContextResponse, val prompt: String)
