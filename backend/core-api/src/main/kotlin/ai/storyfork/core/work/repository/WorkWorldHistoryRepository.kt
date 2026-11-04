package ai.storyfork.core.work.repository

import ai.storyfork.core.work.entity.WorkWorldHistoryEntity
import org.springframework.data.jpa.repository.*

interface WorkWorldHistoryRepository : JpaRepository<WorkWorldHistoryEntity, String> {
    fun findFirstByWorkIdOrderByRevisionNoDesc(workId: String): WorkWorldHistoryEntity?
    fun deleteAllByWorkId(workId: String)
}
