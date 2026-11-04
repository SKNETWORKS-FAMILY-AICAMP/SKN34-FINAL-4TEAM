package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.AiInputSnapshotEntity
import org.springframework.data.jpa.repository.*

interface AiInputSnapshotRepository : JpaRepository<AiInputSnapshotEntity, String> {

}
