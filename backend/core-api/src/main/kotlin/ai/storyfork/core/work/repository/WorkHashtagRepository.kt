package ai.storyfork.core.work.repository

import ai.storyfork.core.work.entity.WorkHashtagEntity
import org.springframework.data.jpa.repository.*

interface WorkHashtagRepository : JpaRepository<WorkHashtagEntity, String> {
    fun findAllByWorkIdOrderByPosition(workId: String): List<WorkHashtagEntity>
    fun deleteAllByWorkId(workId: String)
}
