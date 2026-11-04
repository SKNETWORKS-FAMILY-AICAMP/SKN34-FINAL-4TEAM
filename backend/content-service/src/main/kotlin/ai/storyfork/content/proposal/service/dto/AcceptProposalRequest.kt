package ai.storyfork.content.proposal.service.dto

import jakarta.validation.constraints.*

data class AcceptProposalRequest(@field:Min(0) val revision: Int)
