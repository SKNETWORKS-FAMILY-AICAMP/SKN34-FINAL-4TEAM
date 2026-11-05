package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiInputSnapshotEntity
import org.springframework.data.jpa.repository.*

interface AiInputSnapshotRepository : JpaRepository<AiInputSnapshotEntity, String> {

}
