package ai.storyfork.core.world.entity

import jakarta.persistence.*

@Entity
@Table(name = "setting_visibility_range")
class SettingVisibilityRangeEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "visibility_history_id")
    var visibilityHistoryId: String = "",
    @field:Column(name = "start_episode_id")
    var startEpisodeId: String = "",
    @field:Column(name = "end_episode_id")
    var endEpisodeId: String? = null,
    @field:Column(name = "visibility")
    var visibility: String = "",
)
