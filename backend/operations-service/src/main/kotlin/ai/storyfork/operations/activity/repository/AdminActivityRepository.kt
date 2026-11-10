package ai.storyfork.operations.activity.repository

import ai.storyfork.operations.activity.entity.AdminActivityEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface AdminActivityRepository : JpaRepository<AdminActivityEntity, UUID> {
    /** ponytail: newest 100 only; add a `before` cursor and an `action` filter when the log outgrows it. */
    fun findTop100ByOrderByCreatedAtDescIdDesc(): List<AdminActivityEntity>
}
