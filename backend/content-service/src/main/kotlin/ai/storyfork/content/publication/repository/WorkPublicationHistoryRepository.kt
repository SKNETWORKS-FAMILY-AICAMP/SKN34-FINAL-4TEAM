package ai.storyfork.content.publication.repository

import ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity
import org.springframework.data.jpa.repository.*

interface WorkPublicationHistoryRepository : JpaRepository<WorkPublicationHistoryEntity, String> {
    fun findFirstByWorkIdOrderByRevisionNoDesc(workId: String): WorkPublicationHistoryEntity?
    fun existsByWorkIdAndVisibility(workId: String, visibility: String): Boolean
    fun deleteAllByWorkId(workId: String)
}
