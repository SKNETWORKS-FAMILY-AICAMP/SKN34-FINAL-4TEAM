package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkHashtagEntity
import org.springframework.data.jpa.repository.*

interface WorkHashtagRepository : JpaRepository<WorkHashtagEntity, String> {
    fun findAllByWorkIdOrderByPosition(workId: String): List<WorkHashtagEntity>
    fun deleteAllByWorkId(workId: String)
}
