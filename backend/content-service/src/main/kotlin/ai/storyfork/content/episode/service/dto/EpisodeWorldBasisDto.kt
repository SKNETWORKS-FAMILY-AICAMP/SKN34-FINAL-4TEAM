package ai.storyfork.content.episode.service.dto

import ai.storyfork.content.world.service.dto.WorldRevisionSummaryResponse
import jakarta.validation.constraints.Min
import java.util.UUID

data class EpisodeWorldBasisRequest(val worldId: UUID, val revisionId: UUID, @field:Min(0) val revision: Int)
data class EpisodeWorldBasisResponse(val revision: Int, val basis: WorldRevisionSummaryResponse?)
