package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.ProposalEpisodeChangeEntity
import org.springframework.data.jpa.repository.*

interface ProposalEpisodeChangeRepository : JpaRepository<ProposalEpisodeChangeEntity, String> {
    fun findAllByApplicationId(applicationId: String): List<ProposalEpisodeChangeEntity>
}
