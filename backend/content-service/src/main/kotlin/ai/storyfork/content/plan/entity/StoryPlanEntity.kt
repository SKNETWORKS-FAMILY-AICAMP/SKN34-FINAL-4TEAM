package ai.storyfork.content.plan.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name="story_plan")
class StoryPlanEntity(
    @field:Id var id: String = "",
    @field:Column(name="work_id") var workId: String = "",
    var kind: String = "plot",
    @field:Column(name="parent_id") var parentId: String? = null,
    var title: String = "",
    var content: String = "",
    @field:Column(name="episode_id") var episodeId: String? = null,
    @field:Column(name="episode_number") var episodeNumber: Int? = null,
    var revision: Int = 0,
    @field:Column(name="created_at") var createdAt: Instant = Instant.now(),
    @field:Column(name="deleted_at") var deletedAt: Instant? = null,
    @field:ElementCollection
    @field:CollectionTable(name="story_plan_character", joinColumns=[JoinColumn(name="plan_id")])
    @field:OrderColumn(name="position")
    @field:Column(name="setting_id") var characterIds: MutableList<String> = mutableListOf(),
    @field:ElementCollection
    @field:CollectionTable(name="story_plan_place", joinColumns=[JoinColumn(name="plan_id")])
    @field:OrderColumn(name="position")
    @field:Column(name="setting_id") var placeIds: MutableList<String> = mutableListOf(),
)
