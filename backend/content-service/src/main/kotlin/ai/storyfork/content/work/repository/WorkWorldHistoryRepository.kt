package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkWorldHistoryEntity
import org.springframework.data.jpa.repository.*

interface WorkWorldHistoryRepository : JpaRepository<WorkWorldHistoryEntity, String> {
    fun findFirstByWorkIdOrderByRevisionNoDesc(workId: String): WorkWorldHistoryEntity?
}
