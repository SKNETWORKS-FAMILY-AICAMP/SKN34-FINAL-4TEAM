/** Core 회원 탈퇴 상태(GET /api/v1/me/withdrawal). 유예 중이면 요청·완료 예정 시각이 있습니다(UC-22 A3). */
export type WithdrawalState = { status: 'NONE' } | { status: 'PENDING'; requestedAt: string; dueAt: string }

/** 서버가 받는 탈퇴 사유 최대 길이(Core `WithdrawalRequest`). */
export const WITHDRAWAL_REASON_MAX = 300
