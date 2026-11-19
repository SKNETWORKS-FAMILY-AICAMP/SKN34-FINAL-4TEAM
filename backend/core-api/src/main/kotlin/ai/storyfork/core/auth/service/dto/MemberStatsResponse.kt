package ai.storyfork.core.auth.service.dto

/** 운영 대시보드용 회원 수 통계. 최근 7일 가입은 호출 시점 기준이고, 탈퇴 유예는 아직 처리 전(PENDING)인 탈퇴 요청 수다. */
data class MemberStatsResponse(val total: Long, val joinedLast7Days: Long, val withdrawalPending: Long)
