package ai.storyfork.content.proposal.client.dto
import ai.storyfork.content.context.service.dto.StoryContextResponse

data class GenerationPayload(val context: StoryContextResponse, val prompt: String)
