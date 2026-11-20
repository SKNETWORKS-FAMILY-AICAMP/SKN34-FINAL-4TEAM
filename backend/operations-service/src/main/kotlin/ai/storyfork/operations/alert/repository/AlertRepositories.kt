package ai.storyfork.operations.alert.repository

import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.entity.OperationAlertEntity
import java.time.Instant
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.transaction.annotation.Transactional

interface AlertRuleRepository : JpaRepository<AlertRuleEntity, String> {
    fun findAllByOrderByRuleKeyAsc(): List<AlertRuleEntity>
    fun findAllByEnabledTrue(): List<AlertRuleEntity>
}

interface OperationAlertRepository : JpaRepository<OperationAlertEntity, UUID> {
    /** ponytail: newest 100 only (contract); add a cursor when the list outgrows it. */
    fun findTop100ByOrderByCreatedAtDescIdDesc(): List<OperationAlertEntity>
    fun findTop100ByStatusOrderByCreatedAtDescIdDesc(status: String): List<OperationAlertEntity>
    fun existsByRuleKeyAndStatusIn(ruleKey: String, statuses: Collection<String>): Boolean
    fun countByStatus(status: String): Long

    /** Derived deletes need a transaction of their own because no service transaction wraps the cleanup run. */
    @Transactional
    fun deleteByStatusAndActedAtBefore(status: String, before: Instant): Long
}
