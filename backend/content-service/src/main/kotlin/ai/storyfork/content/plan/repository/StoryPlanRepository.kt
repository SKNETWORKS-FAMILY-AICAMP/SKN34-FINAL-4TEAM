package ai.storyfork.content.plan.repository

import ai.storyfork.content.plan.entity.StoryPlanEntity
import org.springframework.data.jpa.repository.JpaRepository

interface StoryPlanRepository : JpaRepository<StoryPlanEntity, String> {
    fun findAllByWorkIdAndDeletedAtIsNullOrderByCreatedAtAscIdAsc(workId: String): List<StoryPlanEntity>
    fun existsByWorkIdAndParentIdAndDeletedAtIsNull(workId: String, parentId: String): Boolean
}
