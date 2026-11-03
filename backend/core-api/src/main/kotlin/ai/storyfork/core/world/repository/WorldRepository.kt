package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.WorldEntity
import org.springframework.data.jpa.repository.*

interface WorldRepository : JpaRepository<WorldEntity, String> {

}
