import { z } from 'zod'

import type { ReviewFinding, WorldReview } from '../../domain/entities/worldReview'
import type { WorldReviewRepository } from '../../domain/repositories/WorldReviewRepository'
import { authVersion, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'

const uuid = z.uuid()
const count = z.number().int().nonnegative()
const fixBase = { cardId: uuid, text: z.string() }
// 수정안: episode 수정안만 회차 번호가 있고, 그 밖의 칸에 같이 온 episode(null)는 버린다. 서버가 이미 검사한 값의 범위(지적 카드 수·수정안 대상·검토 카드 수)는 다시 보지 않는다.
const fix = z.discriminatedUnion('target', [
  z.object({ ...fixBase, target: z.enum(['body', 'soul', 'goal']) }),
  z.object({ ...fixBase, target: z.literal('episode'), episode: count }),
])
const finding = z.object({
  cardIds: z.array(uuid).min(1),
  kind: z.enum(['contradiction', 'doc_role', 'missing_info', 'other']),
  message: z.string(),
  fix: fix.nullish(),
}).transform(({ fix: suggestion, ...rest }): ReviewFinding => (suggestion ? { ...rest, fix: suggestion } : rest))
const review = z.object({ reviewedCards: count, totalCards: count, findings: z.array(finding) })

const FORMAT = '서버 응답 형식을 확인할 수 없어요.'
const FAILED = '설정집 검토를 요청하지 못했어요. 잠시 뒤 다시 시도해 주세요.'

/**
 * 설정집 AI 검토 API([계약](../../../../docs/design/world-review-contract.md)): `POST /api/v1/world-studios/{id}/reviews` `{consent:true}`.
 * AI 호출이 끝날 때까지 기다리는 동기 요청이라 시간 제한은 초기 분석(`HttpInitialWorldRepository`)과 같은 120초다. 결과는 저장하지 않고 다시 보내지도 않는다
 * (실패는 서버 문구 그대로 던지고, 형식이 어긋난 응답은 일부만 쓰지 않고 통째로 거절한다).
 */
export class HttpWorldReviewRepository implements WorldReviewRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  async review(worldId: string, signal?: AbortSignal): Promise<WorldReview> {
    if (!uuid.safeParse(worldId).success) throw new Error('세계관 주소를 확인하지 못했어요.')
    const version = authVersion()
    const timeout = AbortSignal.timeout(120000), requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await protectedRequest(
      `/api/v1/world-studios/${worldId}/reviews`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': await csrf(requestSignal) }, body: JSON.stringify({ consent: true }), signal: requestSignal },
      version, false, { fetcher: this.fetcher ?? fetch, allowHttpError: true },
    )
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = z.object({ detail: z.string().min(1) }).safeParse(value)
      throw new Error(error.success ? error.data.detail : FAILED)
    }
    const parsed = review.safeParse(value)
    if (!parsed.success) throw new Error(FORMAT)
    return parsed.data
  }
}
