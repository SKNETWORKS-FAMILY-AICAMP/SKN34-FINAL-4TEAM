package ai.storyfork.core.credit.repository

import ai.storyfork.core.credit.entity.CreditReservationLineEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query

interface CreditReservationLineRepository : JpaRepository<CreditReservationLineEntity, UUID> {
    /** 지급분별로 예약 중인 합계. 결과 행은 [grantId, 합계]이다. */
    @Query("select l.grantId, sum(l.amount) from CreditReservationLineEntity l where l.grantId in :grantIds group by l.grantId")
    fun heldByGrant(grantIds: Collection<UUID>): List<Array<Any>>

    fun findByReservationId(reservationId: UUID): List<CreditReservationLineEntity>

    @Modifying(flushAutomatically = true)
    @Query("delete from CreditReservationLineEntity l where l.reservationId = :reservationId")
    fun deleteByReservationId(reservationId: UUID): Int
}
