package ai.storyfork.core.work.service.dto

import ai.storyfork.core.episode_version.service.dto.VersionResponse
import ai.storyfork.core.proposal.service.dto.ProposalResponse
import ai.storyfork.core.publication.service.dto.PublicationResponse

data class HistoryResponse(val versions: List<VersionResponse>, val proposals: List<ProposalResponse>, val policyHistory: List<PolicyResponse>, val publicationHistory: List<PublicationResponse>)
