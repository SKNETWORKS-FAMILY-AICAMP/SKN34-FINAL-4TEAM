package ai.storyfork.core.credit.repository

import ai.storyfork.core.credit.entity.CreditReservationEntity
import jakarta.persistence.LockModeType
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

interface CreditReservationRepository : JpaRepository<CreditReservationEntity, UUID> {
    fun findByOperationKey(operationKey: String): CreditReservationEntity?

    /** 같은 예약을 동시에 정산·해제하지 못하게 잠가서 읽는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from CreditReservationEntity r where r.operationKey = :operationKey")
    fun lockByOperationKey(operationKey: String): CreditReservationEntity?
}
