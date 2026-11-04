package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.ForkPolicyHistoryEntity
import org.springframework.data.jpa.repository.*

interface ForkPolicyHistoryRepository : JpaRepository<ForkPolicyHistoryEntity, String> {
    fun findAllByWorkIdOrderByRevisionNo(workId: String): List<ForkPolicyHistoryEntity>
    fun findFirstByWorkIdOrderByRevisionNoDesc(workId: String): ForkPolicyHistoryEntity?
}
