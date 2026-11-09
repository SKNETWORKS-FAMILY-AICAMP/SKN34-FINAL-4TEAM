package ai.storyfork.content.work.entity

import jakarta.persistence.*
import java.io.Serializable

@Entity
@Table(name = "fork_policy_episode")
@IdClass(ForkPolicyEpisodeEntity.Key::class)
class ForkPolicyEpisodeEntity(
    @field:Id @field:Column(name = "policy_history_id") var policyHistoryId: String = "",
    @field:Id @field:Column(name = "episode_id") var episodeId: String = "",
    @field:Column(name = "work_id") var workId: String = "",
) {
    data class Key(var policyHistoryId: String = "", var episodeId: String = "") : Serializable
}
