package ai.storyfork.content.episode_version.entity

import jakarta.persistence.*

@Entity
@Table(name = "checkpoint_episode")
@IdClass(CheckpointEpisodeEntity.Key::class)
class CheckpointEpisodeEntity(
    @field:Id @field:Column(name = "checkpoint_id")
    var checkpointId: String = "",
    @field:Column(name = "source_work_id")
    var sourceWorkId: String = "",
    @field:Id @field:Column(name = "episode_id")
    var episodeId: String = "",
    @field:Column(name = "episode_version_id")
    var episodeVersionId: String = "",
) {
    data class Key(var checkpointId: String = "", var episodeId: String = "") : java.io.Serializable
}
