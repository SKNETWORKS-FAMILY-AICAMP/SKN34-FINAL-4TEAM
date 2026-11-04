package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkWorldReferenceEntity
import org.springframework.data.jpa.repository.*

interface ForkWorldReferenceRepository : JpaRepository<ForkWorldReferenceEntity, String> {

}
