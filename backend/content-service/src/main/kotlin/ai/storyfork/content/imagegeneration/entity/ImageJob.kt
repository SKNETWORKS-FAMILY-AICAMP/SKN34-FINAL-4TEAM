package ai.storyfork.content.imagegeneration.entity
import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

/** 접수 조건과 결과를 보존한다. 실행 선점은 Repository의 행 잠금 아래 수행한다. */
@Entity @Table(name="image_generation_job", uniqueConstraints=[UniqueConstraint(columnNames=["owner_id","request_key"])])
class ImageJob(
 @Id var id: UUID = UUID.randomUUID(),
 @Column(name="owner_id", nullable=false) var owner: String = "",
 @Column(name="request_key", nullable=false) var requestKey: UUID = UUID.randomUUID(),
 @Column(nullable=false, columnDefinition="text") var input: String = "",
 @Column(name="input_hash", nullable=false) var inputHash: String = "",
 @Column(nullable=false) var status: String = "accepted",
 @Column(nullable=false) var stage: String = "dispatching",
 @Column(name="created_at", nullable=false) var createdAt: Instant = Instant.now(),
 @Column(name="updated_at", nullable=false) var updatedAt: Instant = Instant.now(),
) {
 fun claim(): Boolean {
  if (status !in setOf("accepted","queued")) return false
  if (updatedAt.isBefore(Instant.now().minusSeconds(300))) { status="interrupted"; return false }
  status="running"; stage="generating"; updatedAt=Instant.now(); return true
 }
 fun running() = status=="running"
}
