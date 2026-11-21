import { z } from 'zod'

import type { CreditChange, MemberCredits } from '../../domain/entities/operationsCredit'
import { CREDIT_INSUFFICIENT_MESSAGE } from '../../domain/entities/operationsCredit'
import type { OperationsCreditRepository } from '../../domain/repositories/OperationsCreditRepository'
import { balanceSchema, historySchema } from './HttpCreditLedgerRepository'
import { MESSAGES, read, send, type ServerReason } from './operationsApi'

// 잔액·내역은 Core 원장 응답(/me/credits·history)과 같은 모양이라 그 스키마를 씁니다.
const memberCredits = z.object({ balance: balanceSchema, history: historySchema })
  .transform(({ balance, history }): MemberCredits => ({ balance, history: history.items }))

/** 지급·회수에는 중복 방지 키가 없어, 연결 실패(502)는 반영 여부를 단정하지 않고 확인 뒤 다시 시도하게 안내합니다. */
const MESSAGES_CREDIT: Record<number, string> = {
  ...MESSAGES,
  404: '회원을 찾을 수 없어요. 회원 검색으로 다시 골라 주세요.',
  422: '금액(1~100,000 정수)과 사유(1~200자)를 확인해 주세요.',
  502: '연결된 서비스(Core)에서 처리하지 못했어요. 잔액·내역을 새로고침해 반영 여부를 확인한 뒤 다시 시도해 주세요.',
}
/** 잔액 초과 회수(409 CREDIT_INSUFFICIENT)는 정해진 한국어 문구로, 한글로 온 서버 안내(404·409·422)는 그대로 보입니다. 영문 고정 문구는 상태별 안내로 바뀝니다. */
const reason: ServerReason = (status, { code, message }) => {
  if (code === 'CREDIT_INSUFFICIENT') return CREDIT_INSUFFICIENT_MESSAGE
  return message && [404, 409, 422].includes(status) && (code?.startsWith('UPSTREAM') || /[가-힣]/.test(message)) ? message : undefined
}
const id = encodeURIComponent

/** 운영 크레딧 API(/api/v1/operations/credits). 지급·회수 응답(갱신된 잔액)은 쓰지 않고 화면이 회원 크레딧을 다시 읽습니다. */
export class HttpOperationsCreditRepository implements OperationsCreditRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  member(memberId: string): Promise<MemberCredits> { return read(this.fetcher, `/credits/members/${id(memberId)}`, memberCredits, [], MESSAGES_CREDIT) }
  async grant(memberId: string, input: CreditChange) { await send(this.fetcher, `/credits/members/${id(memberId)}/grants`, 'POST', input, MESSAGES_CREDIT, reason) }
  async revoke(memberId: string, input: CreditChange) { await send(this.fetcher, `/credits/members/${id(memberId)}/revocations`, 'POST', input, MESSAGES_CREDIT, reason) }
}
