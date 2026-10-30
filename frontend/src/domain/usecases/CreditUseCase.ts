import { nid } from '../entities/work'
import type { CreditRepository } from '../repositories/CreditRepository'

export const AI_FAIL_MSG = 'AI 데모 작업에 실패했어요. 자동 재시도하지 않습니다. 다시 요청할 수 있어요'
export const AI_SHORT_MSG = '데모 크레딧이 부족해 실행할 수 없어요'

/** 목업 aiDemo(): 확인 뒤의 데모 크레딧 차감. 확인(confirm)은 화면이 맡습니다. */
export class CreditUseCase {
  private readonly creditRepository: CreditRepository
  constructor(creditRepository: CreditRepository) { this.creditRepository = creditRepository }

  /** approve(잔액)가 false면 'cancel', 'short': 잔액 부족, 'fail': 데모 실패(자동 재시도 없음), 'ok': 차감 */
  async spend(task: string, cost: number, approve: (credits: number) => boolean): Promise<'short' | 'cancel' | 'fail' | 'ok'> {
    const s = await this.creditRepository.get()
    if (s.credits < cost) return 'short'
    if (!approve(s.credits)) return 'cancel'
    if (s.failNext) {
      s.failNext = false
      s.alerts.unshift({ id: nid('alert'), task, status: '처리 실패', stage: '응답 대기', error: '데모 오류: 응답을 받지 못했어요', action: '자동 재시도 없음', detail: '데모 오류: 응답을 받지 못했어요', resolved: false })
      await this.creditRepository.save(s)
      return 'fail'
    }
    s.credits -= cost
    s.usage.unshift({ task, cost })
    await this.creditRepository.save(s)
    return 'ok'
  }

  /** 목업 policySheet(): 데모 잔액·사용 기록 */
  state() { return this.creditRepository.get() }

  /** 목업 #demoFail: 다음 AI 요청 실패 시연 */
  async setFailNext(failNext: boolean) { await this.creditRepository.save({ ...(await this.creditRepository.get()), failNext }) }
}
