package ai.storyfork.content.proposal.service.dto

import com.fasterxml.jackson.annotation.JsonValue

data class ProposalListResponse(@get:JsonValue val items: List<ProposalResponse>)
