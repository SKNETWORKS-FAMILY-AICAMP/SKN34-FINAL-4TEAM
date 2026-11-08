package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.ForkPolicyEpisodeEntity
import org.springframework.data.jpa.repository.JpaRepository

interface ForkPolicyEpisodeRepository : JpaRepository<ForkPolicyEpisodeEntity, ForkPolicyEpisodeEntity.Key> {
    fun findAllByPolicyHistoryId(policyHistoryId: String): List<ForkPolicyEpisodeEntity>
}
