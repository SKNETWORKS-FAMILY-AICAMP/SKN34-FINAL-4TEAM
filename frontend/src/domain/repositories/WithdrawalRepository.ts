import type { WithdrawalState } from '../entities/withdrawal'

/** 탈퇴 요청의 비밀번호 확인 실패(Core 403). */
export class WithdrawalWrongPassword extends Error {}
/** 이미 진행 중인 요청이 있거나(요청 409) 유예 기한이 지나 복구할 수 없음(복구 409). */
export class WithdrawalConflict extends Error {}

/** 로그인한 회원 본인의 탈퇴 요청·상태 조회·복구 계약. */
export interface WithdrawalRepository {
  status(signal?: AbortSignal): Promise<WithdrawalState>
  /** 요청이 받아지면 서버가 모든 로그인 세션을 끊으므로, 구현은 이 브라우저의 로그인 상태도 함께 지웁니다. */
  request(password: string, reason: string | null): Promise<WithdrawalState>
  restore(): Promise<void>
}
