package ai.storyfork.core.proposal.service.dto

import ai.storyfork.core.context.service.dto.StoryContextResponse

data class ProposalResponse(val id: String, val text: String, val model: String, val revision: Int, val status: String, val prompt: String, val baseBody: String, val context: StoryContextResponse, val providerResponseId: String?, val usage: UsageResponse?, val createdAt: String, val targetEpisode: Int?, val appliedVersionId: String?)
