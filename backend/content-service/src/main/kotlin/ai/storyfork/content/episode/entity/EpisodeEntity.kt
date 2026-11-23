package ai.storyfork.content.episode.entity

import java.time.Instant
import org.hibernate.annotations.SQLRestriction
import jakarta.persistence.*
import java.util.UUID

@Entity
@Table(name = "episode")
@SQLRestriction("deleted_at IS NULL")
class EpisodeEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "sequence")
    var sequence: Int = 0,
    @field:Column(name = "deleted_at")
    var deletedAt: Instant? = null,
    @field:Column(name = "draft_revision_floor")
    var draftRevisionFloor: Int = -1,
    @field:Column(name = "basis_world_id")
    var basisWorldId: UUID? = null,
    @field:Column(name = "basis_world_revision_id")
    var basisWorldRevisionId: UUID? = null,
    @field:Column(name = "basis_revision")
    var basisRevision: Int = 0,
    /** 운영자가 독자에게 숨긴 회차다(V44). 작가의 집필은 막지 않는다. 상속 회차는 직접 바꾸지 못한다(원작 회차를 제한해야 한다). */
    @field:Column(name = "restricted")
    var restricted: Boolean = false,
)
