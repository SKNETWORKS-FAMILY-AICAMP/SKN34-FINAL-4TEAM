package ai.storyfork.content.imagegeneration.repository
import ai.storyfork.content.imagegeneration.entity.ImageJob
import java.time.Instant
import java.util.UUID
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param
interface ImageJobRepository : JpaRepository<ImageJob,UUID> {
 fun findByOwnerAndRequestKey(owner:String, requestKey:UUID):ImageJob?
 @Lock(LockModeType.PESSIMISTIC_WRITE)
 @Query("select j from ImageJob j where j.id=:id")
 fun lock(@Param("id") id:UUID):ImageJob?
 fun findAllByStatusInAndUpdatedAtBefore(status:Collection<String>, time:Instant):List<ImageJob>
}
