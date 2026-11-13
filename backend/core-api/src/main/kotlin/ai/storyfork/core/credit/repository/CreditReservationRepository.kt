package ai.storyfork.core.credit.repository

import ai.storyfork.core.credit.entity.CreditReservationEntity
import jakarta.persistence.LockModeType
import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

interface CreditReservationRepository : JpaRepository<CreditReservationEntity, UUID> {
    fun findByOperationKey(operationKey: String): CreditReservationEntity?

    /** 같은 예약을 동시에 정산·해제하지 못하게 잠가서 읽는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from CreditReservationEntity r where r.operationKey = :operationKey")
    fun lockByOperationKey(operationKey: String): CreditReservationEntity?

    /** [before] 이전에 잡아 두고 아직 정산·해제되지 않은 예약을 오래된 순으로 반환한다. */
    @Query("select r from CreditReservationEntity r where r.status = 'RESERVED' and r.reservedAt <= :before order by r.reservedAt, r.id")
    fun findStale(before: Instant, pageable: Pageable): List<CreditReservationEntity>
}
