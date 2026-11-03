package ai.storyfork.core.content.client.dto

import ai.storyfork.core.content.domain.StoryContext
import ai.storyfork.core.content.domain.Usage

data class GenerationPayload(val context: StoryContext, val prompt: String)
data class GenerationResponse(val text: String, val model: String, val providerResponseId: String? = null, val usage: Usage? = null)
