package ai.storyfork.core.credit.repository

import ai.storyfork.core.credit.entity.CreditLedgerEntryEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface CreditLedgerEntryRepository : JpaRepository<CreditLedgerEntryEntity, UUID> {
    /** 지급분별로 이미 빠져나간(사용·소멸) 합계. 결과 행은 [grantId, 합계]이다. */
    @Query("select e.grantId, sum(e.amount) from CreditLedgerEntryEntity e where e.grantId in :grantIds group by e.grantId")
    fun usedByGrant(grantIds: Collection<UUID>): List<Array<Any>>

    fun findByOperationKey(operationKey: String): List<CreditLedgerEntryEntity>

    @Query("select e from CreditLedgerEntryEntity e where e.grantId in (select g.id from CreditGrantEntity g where g.memberId = :memberId) order by e.occurredAt desc, e.id desc")
    fun history(memberId: UUID): List<CreditLedgerEntryEntity>
}
