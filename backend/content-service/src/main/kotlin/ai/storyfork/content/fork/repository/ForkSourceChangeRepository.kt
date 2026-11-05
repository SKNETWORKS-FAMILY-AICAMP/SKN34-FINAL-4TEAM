package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkSourceChangeEntity
import org.springframework.data.jpa.repository.*

interface ForkSourceChangeRepository : JpaRepository<ForkSourceChangeEntity, String> {
    fun findAllByForkWorkId(forkWorkId: String): List<ForkSourceChangeEntity>
}
