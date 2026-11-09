package ai.storyfork.core.auth.service.dto

import java.util.UUID

/** 내부 인증 확인에만 사용하는 최소 회원 식별자와 운영 관리자 여부다. */
data class VerifiedMemberResponse(val memberId: UUID, val operator: Boolean)
