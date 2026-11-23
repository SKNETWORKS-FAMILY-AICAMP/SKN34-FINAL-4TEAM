import { z } from 'zod'

import { isEpisodeKey } from '../../domain/entities/characterDocs'
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
// 기준(basis): 수정안이 가리킨 카드마다 검토한 초안의 그 카드 글. 인물 문서는 그 카드에 있을 때만 오고(null은 없는 것), 회차 기억의 키는 JSON이라 회차 번호 글자다.
const basisCard = z.object({
  body: z.string(),
  characterDocs: z.object({ soul: z.string(), goal: z.string(), episodes: z.record(z.string().refine(isEpisodeKey), z.string()) }).nullish(),
}).transform(({ characterDocs, ...rest }) => (characterDocs ? { ...rest, characterDocs } : rest))
const review = z.object({
  reviewedCards: count, totalCards: count, findings: z.array(finding),
  reviewedAt: z.iso.datetime({ offset: true }).transform((at) => new Date(at)),
  basis: z.record(uuid, basisCard),
})

const FORMAT = '서버 응답 형식을 확인할 수 없어요.'
const FAILED = '설정집 검토를 요청하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const LOAD_FAILED = '지난 검토 결과를 불러오지 못했어요.'
/** 저장된 검토가 아직 없을 때만 오는 404의 코드. 세계관이 없거나 남의 것인 404는 코드가 없는 기존 규칙이라 '검토 없음'과 구분한다. */
const NO_REVIEW = 'WORLD_REVIEW_NOT_FOUND'

/**
 * 설정집 AI 검토 API([계약](../../../../docs/design/world-review-contract.md)): `POST /api/v1/world-studios/{id}/reviews` `{consent:true}`와 서버가 저장한 마지막 검토를 읽는 `GET …/reviews/latest`(#555).
 * 검토는 AI 호출이 끝날 때까지 기다리는 동기 요청이라 시간 제한은 초기 분석(`HttpInitialWorldRepository`)과 같은 120초이고, 읽기는 짧은 DB 조회라 20초다. 두 응답은 같은 모양이며 검토 시각(`reviewedAt`)과
 * 수정안 잠금의 기준(`basis`)을 함께 준다. 실패는 서버 문구 그대로 던지고, 형식이 어긋난 응답은 일부만 쓰지 않고 통째로 거절한다.
 */
export class HttpWorldReviewRepository implements WorldReviewRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  /** 인증(과 POST의 CSRF)을 붙여 보내고, 본문은 읽을 수 있을 때만 값으로 돌려준다. */
  private async send(worldId: string, path: string, post: boolean, timeout: number, signal?: AbortSignal) {
    if (!uuid.safeParse(worldId).success) throw new Error('세계관 주소를 확인하지 못했어요.')
    const version = authVersion()
    const limit = AbortSignal.timeout(timeout), requestSignal = signal ? AbortSignal.any([signal, limit]) : limit
    const response = await protectedRequest(
      `/api/v1/world-studios/${worldId}/reviews${path}`,
      post
        ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': await csrf(requestSignal) }, body: JSON.stringify({ consent: true }), signal: requestSignal }
        : { method: 'GET', signal: requestSignal },
      version, false, { fetcher: this.fetcher ?? fetch, allowHttpError: true },
    )
    const value: unknown = await response.json().catch(() => undefined)
    return { response, value }
  }

  private read({ response, value }: { response: Response; value: unknown }, failed: string): WorldReview {
    if (!response.ok) {
      const error = z.object({ detail: z.string().min(1) }).safeParse(value)
      throw new Error(error.success ? error.data.detail : failed)
    }
    const parsed = review.safeParse(value)
    if (!parsed.success) throw new Error(FORMAT)
    return parsed.data
  }

  async review(worldId: string, signal?: AbortSignal): Promise<WorldReview> {
    return this.read(await this.send(worldId, '', true, 120000, signal), FAILED)
  }

  async latest(worldId: string, signal?: AbortSignal): Promise<WorldReview | null> {
    const sent = await this.send(worldId, '/latest', false, 20000, signal)
    if (sent.response.status === 404 && z.object({ code: z.literal(NO_REVIEW) }).safeParse(sent.value).success) return null
    return this.read(sent, LOAD_FAILED)
  }
}
