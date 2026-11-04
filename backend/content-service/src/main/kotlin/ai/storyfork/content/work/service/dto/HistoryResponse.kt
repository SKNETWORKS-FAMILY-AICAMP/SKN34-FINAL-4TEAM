package ai.storyfork.content.work.service.dto

import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.proposal.service.dto.ProposalResponse
import ai.storyfork.content.publication.service.dto.PublicationResponse

data class HistoryResponse(val versions: List<VersionResponse>, val proposals: List<ProposalResponse>, val policyHistory: List<PolicyResponse>, val publicationHistory: List<PublicationResponse>)
