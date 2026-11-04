package ai.storyfork.core.work.repository

import ai.storyfork.core.work.entity.ForkPolicyHistoryEntity
import org.springframework.data.jpa.repository.*

interface ForkPolicyHistoryRepository : JpaRepository<ForkPolicyHistoryEntity, String> {
    fun findAllByWorkIdOrderByRevisionNo(workId: String): List<ForkPolicyHistoryEntity>
    fun findFirstByWorkIdOrderByRevisionNoDesc(workId: String): ForkPolicyHistoryEntity?
}
