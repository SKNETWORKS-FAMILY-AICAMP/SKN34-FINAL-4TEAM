package ai.storyfork.core.credit.service.dto

import java.util.UUID

/** 오래 닫히지 않은 예약을 해제할 때 필요한 값. */
data class StaleReservation(val id: UUID, val memberId: UUID, val operationKey: String)
