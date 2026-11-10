package ai.storyfork.core.credit.repository

import ai.storyfork.core.credit.entity.CreditGrantEntity
import jakarta.persistence.LockModeType
import java.time.Instant
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

interface CreditGrantRepository : JpaRepository<CreditGrantEntity, UUID> {
    /** 아직 소멸하지 않은 본인 지급분을 잠가서 읽는다. 같은 회원의 동시 차감이 같은 잔액을 두 번 쓰지 못하게 한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from CreditGrantEntity g where g.memberId = :memberId and g.expiresAt > :now order by g.expiresAt, g.grantedAt, g.id")
    fun lockActive(memberId: UUID, now: Instant): List<CreditGrantEntity>

    @Query("select g from CreditGrantEntity g where g.memberId = :memberId and g.expiresAt > :now order by g.expiresAt, g.grantedAt, g.id")
    fun findActive(memberId: UUID, now: Instant): List<CreditGrantEntity>

    @Query("select g from CreditGrantEntity g where g.memberId = :memberId order by g.grantedAt desc, g.id desc")
    fun history(memberId: UUID): List<CreditGrantEntity>

    fun existsByMemberIdAndKind(memberId: UUID, kind: String): Boolean

    /**
     * 소멸 시각이 지났고 아직 남은 양이 있으며 소멸 기록이 없는 지급분을 잠가서 읽는다. 이미 다 쓴 지급분은 매번 다시 읽지 않는다.
     * 잠그지 않으면 자정 직전에 시작한 차감이 커밋되기 전의 남은 양으로 소멸을 기록해 지급량보다 많이 빠져나간 것으로 남을 수 있다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from CreditGrantEntity g where g.expiresAt <= :now and g.amount > coalesce((select sum(u.amount) from CreditLedgerEntryEntity u where u.grantId = g.id), 0) and not exists (select 1 from CreditLedgerEntryEntity e where e.grantId = g.id and e.kind = 'expire')")
    fun expiredWithoutRecord(now: Instant): List<CreditGrantEntity>
}
