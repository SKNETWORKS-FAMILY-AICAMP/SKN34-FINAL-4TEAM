package ai.storyfork.core.publication.repository

import ai.storyfork.core.publication.entity.WorkRightsDeclarationEntity
import org.springframework.data.jpa.repository.*

interface WorkRightsDeclarationRepository : JpaRepository<WorkRightsDeclarationEntity, String> {
    fun deleteAllByWorkId(workId: String)
}
