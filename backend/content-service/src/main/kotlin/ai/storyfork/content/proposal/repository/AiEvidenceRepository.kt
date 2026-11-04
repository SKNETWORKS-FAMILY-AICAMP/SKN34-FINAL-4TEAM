package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiEvidenceEntity
import org.springframework.data.jpa.repository.*

interface AiEvidenceRepository : JpaRepository<AiEvidenceEntity, String> {

}
