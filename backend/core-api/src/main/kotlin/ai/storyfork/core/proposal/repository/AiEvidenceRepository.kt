package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.AiEvidenceEntity
import org.springframework.data.jpa.repository.*

interface AiEvidenceRepository : JpaRepository<AiEvidenceEntity, String> {

}
