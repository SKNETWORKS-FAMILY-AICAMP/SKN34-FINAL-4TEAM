import type { CreditBalance, CreditHistoryItem } from './creditLedger'

/** 운영자가 보는 회원 크레딧(DEC-57): Core 원장의 잔액(지급 종류별 포함)과 내역(최신순)을 그대로 받습니다. */
export type MemberCredits = { balance: CreditBalance; history: CreditHistoryItem[] }
/** 수동 지급·회수 요청. 사유는 활동 기록에 남습니다. */
export type CreditChange = { amount: number; reason: string }
export type CreditChangeKind = 'grant' | 'revoke'
/** 회원 목록 행의 잔액(`CreditBalanceResponse.total`과 같은 계산). 서버가 모르는 회원은 결과에서 뺀다. */
export type MemberBalance = { memberId: string; total: number }
/** 묶음 잔액 API 한 번에 보낼 수 있는 회원 수의 상한. */
export const BALANCE_BATCH = 100

export const CREDIT_AMOUNT_MAX = 100_000
export const CREDIT_REASON_MAX = 200

/** 크레딧 조회·지급·회수는 운영 권한 `credits`(화면 이름 '크레딧 운영')가 필요합니다. 403이면 다시 시도 대신 이 안내를 보입니다. */
export const CREDITS_FORBIDDEN = "크레딧을 보고 바꾸려면 '크레딧 운영' 권한이 필요해요."
/** 회원 찾기는 사용자 탭과 같은 검색 API라 `users` 권한('사용자 관리')이 필요합니다. */
export const MEMBER_SEARCH_FORBIDDEN = "회원을 찾으려면 '사용자 관리' 권한이 필요해요."
/** 회수는 쓸 수 있는 잔액 안에서만 됩니다(409 CREDIT_INSUFFICIENT, 서버는 아무것도 바꾸지 않음). */
export const CREDIT_INSUFFICIENT_MESSAGE = '회수할 수 있는 잔액이 부족해요. 쓸 수 있는 잔액 안에서만 회수할 수 있어요.'
