package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.WorldEntity
import org.springframework.data.jpa.repository.*

interface WorldRepository : JpaRepository<WorldEntity, String> {

}
