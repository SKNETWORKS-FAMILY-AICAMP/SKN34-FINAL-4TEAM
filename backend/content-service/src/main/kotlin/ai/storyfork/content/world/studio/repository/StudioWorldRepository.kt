package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.StudioWorld
import java.util.UUID
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface StudioWorldRepository : JpaRepository<StudioWorld, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from StudioWorld w where w.id=:world and w.ownerSubject=:subject")
    fun lockOwned(@Param("world") world: UUID, @Param("subject") subject: UUID): StudioWorld?
}
