import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { login } from '../api/auth'
import { HttpWorldReviewRepository } from './HttpWorldReviewRepository'

const world = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID()
/**
 * Content가 주는 응답. `fix`·`fix.episode`는 없으면 키 자체를 생략한다(계약). 예전 응답처럼 null로 와도 같은 뜻으로 읽는다(두 번째 지적).
 * episode는 episode 수정안에만 의미가 있다. `reviewedAt`은 서버가 검토를 저장한 시각(마이크로초까지 올 수 있다)이고, `basis`는 수정안이 가리킨 카드마다 검토한 초안의 그 카드 글이다
 * (회차 기억의 키는 JSON이라 글자).
 */
const AT = '2026-11-19T03:25:41.123456Z'
const basisWire = () => ({
  [a]: { body: '가람 본문', characterDocs: { soul: '옛 SOUL', goal: '옛 GOAL', episodes: { '3': '옛 기억' } } },
  [b]: { body: '나래 본문' },
})
const wire = (over: Record<string, unknown> = {}) => ({
  draftRevision: 12, reviewedCards: 2, totalCards: 2, model: 'gpt-6-luna', reviewedAt: AT, basis: basisWire(),
  findings: [
    { cardIds: [a, b], kind: 'contradiction', message: '두 카드가 어긋나요.', fix: { cardId: a, target: 'soul', text: '새 SOUL' } },
    { cardIds: [b], kind: 'doc_role', message: '문서 역할이 달라요.', fix: null },
    { cardIds: [a], kind: 'missing_info', message: '정보가 빠졌어요.', fix: { cardId: a, target: 'episode', episode: 3, text: '새 기억' } },
    { cardIds: [a], kind: 'other', message: '기타 지적이에요.' },
    { cardIds: [b], kind: 'doc_role', message: '목표가 비었어요.', fix: { cardId: b, target: 'goal', episode: null, text: '새 GOAL' } },
  ],
  ...over,
})
const url = `/api/v1/world-studios/${world}/reviews`

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'studio-csrf' }) : Response.json({ accessToken: 'studio-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpWorldReviewRepository', () => {
  it('동의를 싣어 Bearer·CSRF로 POST하고 응답을 검토 결과로 읽는다(수정안 없음은 fix가 없고 episode는 episode 수정안에만 있다)', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire()))
    const result = await new HttpWorldReviewRepository(fetcher).review(world)
    const [path, init] = fetcher.mock.calls[0]
    expect(path).toBe(url)
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ consent: true }) })
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer studio-bearer', 'X-CSRF-TOKEN': 'studio-csrf', 'Content-Type': 'application/json' }))
    expect(result).toEqual({
      reviewedCards: 2, totalCards: 2, // 화면이 쓰지 않는 draftRevision·model은 읽지 않는다
      reviewedAt: new Date(AT), basis: basisWire(), // 시각은 Date로, 기준은 그대로(잠금이 새로 고친 뒤에도 같은 기준으로 견준다)
      findings: [
        { cardIds: [a, b], kind: 'contradiction', message: '두 카드가 어긋나요.', fix: { cardId: a, target: 'soul', text: '새 SOUL' } },
        { cardIds: [b], kind: 'doc_role', message: '문서 역할이 달라요.' },
        { cardIds: [a], kind: 'missing_info', message: '정보가 빠졌어요.', fix: { cardId: a, target: 'episode', episode: 3, text: '새 기억' } },
        { cardIds: [a], kind: 'other', message: '기타 지적이에요.' },
        { cardIds: [b], kind: 'doc_role', message: '목표가 비었어요.', fix: { cardId: b, target: 'goal', text: '새 GOAL' } },
      ],
    })
    expect(result.findings.map((f) => Object.hasOwn(f, 'fix'))).toEqual([true, false, true, false, true])
    expect(result.findings.filter((f) => f.fix?.target !== 'episode').every((f) => !Object.hasOwn(f.fix ?? {}, 'episode'))).toBe(true)
  })

  it('카드가 0장이면 Content가 AI를 부르지 않고 모델을 빈 글로 주는데, 그 응답도 빈 검토로 받는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ draftRevision: 0, reviewedCards: 0, totalCards: 0, findings: [], model: '', reviewedAt: AT, basis: {} }))
    await expect(new HttpWorldReviewRepository(fetcher).review(world)).resolves.toEqual({ reviewedCards: 0, totalCards: 0, findings: [], reviewedAt: new Date(AT), basis: {} })
  })

  it.each([
    ['카드 id가 없는 지적', { cardIds: [] }],
    ['UUID가 아닌 카드 id', { cardIds: ['card-1'] }],
    ['모르는 지적 종류', { kind: 'style' }],
    ['회차 번호가 없는 episode 수정안', { fix: { cardId: a, target: 'episode', text: '글' } }],
    ['음수 회차의 episode 수정안', { fix: { cardId: a, target: 'episode', episode: -1, text: '글' } }],
    ['모르는 칸의 수정안', { fix: { cardId: a, target: 'memory', text: '글' } }],
  ])('%s이 있는 응답은 일부만 쓰지 않고 형식 오류로 거절한다', async (_, over) => {
    const base = { cardIds: [a], kind: 'other', message: '지적이에요.' }
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire({ findings: [{ ...base, ...over }] })))
    await expect(new HttpWorldReviewRepository(fetcher).review(world)).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it.each([
    ['음수 카드 수', { reviewedCards: -1 }],
    ['지적이 목록이 아니다', { findings: null }],
    ['검토 시각이 없다', { reviewedAt: undefined }],
    ['검토 시각이 날짜 글이 아니다', { reviewedAt: '어제' }],
    ['검토 시각에 시간대가 없다', { reviewedAt: '2026-11-19T03:25:41' }],
    ['기준(basis)이 없다', { basis: undefined }],
    ['기준이 객체가 아니다', { basis: [] }],
    ['기준의 카드 id가 UUID가 아니다', { basis: { 'card-1': { body: '글' } } }],
    ['기준의 카드에 본문이 없다', { basis: { [a]: {} } }],
    ['기준의 인물 문서가 SOUL 없이 온다', { basis: { [a]: { body: '글', characterDocs: { goal: '', episodes: {} } } } }],
    ['기준의 회차 기억 키가 회차 번호가 아니다', { basis: { [a]: { body: '글', characterDocs: { soul: '', goal: '', episodes: { '03': '기억' } } } } }],
    ['기준의 회차 기억이 글이 아니다', { basis: { [a]: { body: '글', characterDocs: { soul: '', goal: '', episodes: { '3': 7 } } } } }],
  ])('%s: 형식 오류로 거절한다', async (_, over) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire(over)))
    await expect(new HttpWorldReviewRepository(fetcher).review(world)).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it.each([
    [422, 'AI_CONSENT_REQUIRED', 'OpenAI 전송에 동의해 주세요.'],
    [404, undefined, '세계관을 찾을 수 없어요.'],
    [502, 'AI_OUTPUT_INVALID', 'AI 응답을 확인하지 못했어요.'],
    [503, 'AI_NOT_CONFIGURED', 'AI 검토가 아직 설정되지 않았어요.'],
    [504, 'AI_TIMEOUT', 'AI 응답이 늦어져 검토하지 못했어요.'],
  ])('오류 %s %s는 서버가 준 문구를 그대로 던지고 다시 보내지 않는다', async (status, code, detail) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail, ...(code && { code }) }, { status }))
    await expect(new HttpWorldReviewRepository(fetcher).review(world)).rejects.toThrow(detail)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('오류 본문을 읽을 수 없으면 일반 안내를 던진다(성공·빈 결과로 바꾸지 않는다)', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    await expect(new HttpWorldReviewRepository(fetcher).review(world)).rejects.toThrow('설정집 검토를 요청하지 못했어요.')
  })

  it('UUID가 아닌 세계관 주소는 보내지 않고, 호출자의 취소 신호는 요청에 이어진다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire()))
    await expect(new HttpWorldReviewRepository(fetcher).review('qa')).rejects.toThrow('세계관')
    expect(fetcher).not.toHaveBeenCalled()
    const controller = new AbortController()
    await new HttpWorldReviewRepository(fetcher).review(world, controller.signal)
    controller.abort()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
})

describe('HttpWorldReviewRepository 마지막 검토 읽기(#555)', () => {
  const latestUrl = `${url}/latest`
  const NOT_FOUND = { detail: '저장된 설정집 검토가 없어요.', code: 'WORLD_REVIEW_NOT_FOUND' }

  it('Bearer로 GET해(본문·CSRF 없음) 검토 직후와 같은 모양으로 읽는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire()))
    const result = await new HttpWorldReviewRepository(fetcher).latest(world)
    const [path, init] = fetcher.mock.calls[0]
    expect(path).toBe(latestUrl)
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' })
    expect(init.body).toBeUndefined()
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer studio-bearer' }))
    expect(init.headers).not.toHaveProperty('X-CSRF-TOKEN')
    expect(result).toEqual(await new HttpWorldReviewRepository(vi.fn().mockResolvedValue(Response.json(wire()))).review(world)) // POST 응답과 같은 모양이다
    expect(result?.reviewedAt).toEqual(new Date(AT))
    expect(result?.findings).toHaveLength(5)
    expect(result?.basis).toEqual(basisWire())
  })

  it('기준의 인물 문서가 null이면 없는 것으로 읽고, 키도 만들지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire({ basis: { [a]: { body: '글', characterDocs: null } } })))
    const result = await new HttpWorldReviewRepository(fetcher).latest(world)
    expect(result?.basis).toEqual({ [a]: { body: '글' } })
    expect(Object.hasOwn(result!.basis[a], 'characterDocs')).toBe(false)
  })

  it('저장된 검토가 없을 때만(404 WORLD_REVIEW_NOT_FOUND) 검토 없음(null)으로 읽는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(NOT_FOUND, { status: 404 }))
    await expect(new HttpWorldReviewRepository(fetcher).latest(world)).resolves.toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['세계관이 없거나 남의 것인 404(기존 규칙, 코드 없음)', 404, { detail: '세계관을 찾을 수 없어요.' }],
    ['다른 코드의 404', 404, { detail: '세계관을 찾을 수 없어요.', code: 'WORLD_NOT_FOUND' }],
    ['403', 403, { detail: '권한이 없어요.' }],
    ['500', 500, { detail: '서버 오류가 났어요.', code: 'INTERNAL' }],
    ['503', 503, { detail: '잠시 뒤 다시 시도해 주세요.' }],
  ])('%s은 검토 없음으로 바꾸지 않고 서버 문구를 던진다', async (_, status, body) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(body, { status }))
    await expect(new HttpWorldReviewRepository(fetcher).latest(world)).rejects.toThrow(body.detail)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('오류 본문을 읽을 수 없으면(404 포함) 일반 안내를 던진다(검토 없음·성공으로 바꾸지 않는다)', async () => {
    for (const status of [404, 502]) {
      const fetcher = vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status }))
      await expect(new HttpWorldReviewRepository(fetcher).latest(world)).rejects.toThrow('지난 검토 결과를 불러오지 못했어요.')
    }
  })

  it('형식이 어긋난 성공 응답은 일부만 쓰지 않고 형식 오류로 거절한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire({ basis: undefined })))
    await expect(new HttpWorldReviewRepository(fetcher).latest(world)).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it('UUID가 아닌 세계관 주소는 보내지 않고, 호출자의 취소 신호는 요청에 이어진다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(wire()))
    await expect(new HttpWorldReviewRepository(fetcher).latest('qa')).rejects.toThrow('세계관')
    expect(fetcher).not.toHaveBeenCalled()
    const controller = new AbortController()
    await new HttpWorldReviewRepository(fetcher).latest(world, controller.signal)
    controller.abort()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
