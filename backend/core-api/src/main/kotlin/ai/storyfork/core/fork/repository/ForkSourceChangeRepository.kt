package ai.storyfork.core.fork.repository

import ai.storyfork.core.fork.entity.ForkSourceChangeEntity
import org.springframework.data.jpa.repository.*

interface ForkSourceChangeRepository : JpaRepository<ForkSourceChangeEntity, String> {
    fun findAllByForkWorkId(forkWorkId: String): List<ForkSourceChangeEntity>
}
