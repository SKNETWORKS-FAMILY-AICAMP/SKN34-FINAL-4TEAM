package ai.storyfork.content.publication.repository

import ai.storyfork.content.publication.entity.WorkRightsDeclarationEntity
import org.springframework.data.jpa.repository.*

interface WorkRightsDeclarationRepository : JpaRepository<WorkRightsDeclarationEntity, String> {

}
