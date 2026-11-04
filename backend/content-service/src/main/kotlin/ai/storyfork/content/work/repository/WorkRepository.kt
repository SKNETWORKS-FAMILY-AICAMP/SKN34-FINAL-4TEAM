package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface WorkRepository : JpaRepository<WorkEntity, String> {
    @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from WorkEntity w where w.id in :ids order by w.id")
    fun lockAll(@Param("ids") ids: Collection<String>): List<WorkEntity>
    fun findAllByOwnerIdOrderByCreatedAtDesc(ownerId: String): List<WorkEntity>
}
