package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ProposalEpisodeChangeEntity
import org.springframework.data.jpa.repository.*

interface ProposalEpisodeChangeRepository : JpaRepository<ProposalEpisodeChangeEntity, String> {
    fun findAllByApplicationId(applicationId: String): List<ProposalEpisodeChangeEntity>
}
