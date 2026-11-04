package ai.storyfork.core.fork.repository

import ai.storyfork.core.fork.entity.ForkWorldReferenceEntity
import org.springframework.data.jpa.repository.*

interface ForkWorldReferenceRepository : JpaRepository<ForkWorldReferenceEntity, String> {

}
