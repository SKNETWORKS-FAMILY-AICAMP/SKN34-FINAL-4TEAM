package ai.storyfork.core.contentimage.repository

import ai.storyfork.core.contentimage.entity.ImageWork
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface ImageWorkRepository : JpaRepository<ImageWork, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from ImageWork w where w.id = :id and w.ownerId = :owner")
    fun lockOwned(@Param("id") id: String, @Param("owner") owner: String): ImageWork?
}
