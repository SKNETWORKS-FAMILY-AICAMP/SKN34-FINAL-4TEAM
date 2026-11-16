import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login, refresh } from '../api/auth'
import { HttpFeedbackReportRepository } from './HttpFeedbackReportRepository'

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', workId: 'w1', workTitle: '작품', episodeNumber: 3, publishedVersionId: 'v1', kind: 'typo', body: '본문', quote: null, visibility: 'private',
  status: 'unchecked', reporterName: '독자', mine: true, owner: false, authorChecked: false, withdrawn: false, amendments: [], responses: [],
  createdAt: '2026-11-10T01:23:45Z', updatedAt: '2026-11-10T01:23:45Z', ...extra,
})
const headers = (fetcher: ReturnType<typeof vi.fn>, call = 0) => new Headers(fetcher.mock.calls[call][1].headers)

const signIn = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'report-csrf' })
    : Response.json({ accessToken: 'report-bearer', user: { id: 'reader', email: 'reader@example.invalid', nickname: '독자', operator: false } })))
  await login('reader@example.invalid', 'test-password')
}
const signOut = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
  await refresh().catch(() => {})
}

afterEach(() => vi.unstubAllGlobals())

describe('회차 제보 읽기 (공개 API, Bearer 선택)', () => {
  it('로그인 상태면 공개 목록에도 Bearer를 보내 내 비공개 제보와 소유자의 모든 제보를 받는다', async () => {
    await signIn()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [row({ mine: true, visibility: 'private' })] }))
    const [first] = await new HttpFeedbackReportRepository(fetcher).listEpisode('w1', 3)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/public/works/w1/episodes/3/feedback-reports', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).get('Authorization')).toBe('Bearer report-bearer')
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
    expect(first).toMatchObject({ id: 'r1', kind: 'typo', status: 'unchecked', mine: true, quote: null })
  })

  it('익명이면 Authorization 없이 읽고 원문을 숨긴 제보(body·quote·reporterName null)도 받는다', async () => {
    await signOut()
    const hidden = row({ body: null, quote: null, reporterName: null, mine: false, responses: [{ id: 'p1', authorName: '작가', body: '답변', isPublic: true, createdAt: '2026-11-10T02:00:00Z' }] })
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [hidden] }))
    const [first] = await new HttpFeedbackReportRepository(fetcher).listEpisode('w1', 3)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(headers(fetcher).has('Authorization')).toBe(false)
    expect(first).toMatchObject({ body: null, quote: null, reporterName: null, responses: [{ authorName: '작가', isPublic: true }] })
  })

  it('내 제보와 작가 피드백함은 회원 전용 경로를 Bearer로 읽는다', async () => {
    await signIn()
    // 호출마다 새 Response를 돌려준다(같은 Response는 본문을 한 번만 읽을 수 있다).
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ items: [row()] }))
    const repo = new HttpFeedbackReportRepository(fetcher)
    expect(await repo.listMine()).toHaveLength(1)
    expect(await repo.listInbox()).toHaveLength(1)
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(['/api/v1/works/feedback-reports/mine', '/api/v1/works/feedback-reports/inbox'])
    expect(headers(fetcher, 0).get('Authorization')).toBe('Bearer report-bearer')
    expect(headers(fetcher, 1).get('Authorization')).toBe('Bearer report-bearer')
  })

  it('작가 피드백함은 작품을 정하면 workId 쿼리로 그 작품 항목만 서버에 묻고, 정하지 않으면 쿼리 없이 읽는다', async () => {
    await signIn()
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ items: [row({ owner: true, mine: false })] }))
    const repo = new HttpFeedbackReportRepository(fetcher)
    const workId = '11111111-1111-4111-8111-111111111111'
    expect(await repo.listInbox(workId)).toHaveLength(1)
    await repo.listInbox()
    // 쿼리 값은 인코딩돼 다른 쿼리를 끼워 넣을 수 없다.
    await repo.listInbox('w&x=1')
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      `/api/v1/works/feedback-reports/inbox?workId=${workId}`,
      '/api/v1/works/feedback-reports/inbox',
      '/api/v1/works/feedback-reports/inbox?workId=w%26x%3D1',
    ])
    expect(headers(fetcher, 0).get('Authorization')).toBe('Bearer report-bearer')
  })

  it('잘못된 유형·상태나 형식이 다른 응답은 검증 오류로 거절한다', async () => {
    await signOut()
    for (const bad of [{ items: [row({ kind: 'comment' })] }, { items: [row({ status: 'done' })] }, { items: [row({ createdAt: 'yesterday' })] }, { items: [{ id: 'r1' }] }, { rows: [] }]) {
      const fetcher = vi.fn().mockResolvedValue(Response.json(bad))
      await expect(new HttpFeedbackReportRepository(fetcher).listEpisode('w1', 3)).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    }
  })
})

describe('제보 쓰기 (회원, CSRF)', () => {
  beforeEach(signIn)
  const sent = (fetcher: ReturnType<typeof vi.fn>) => ({ url: fetcher.mock.calls[0][0], init: fetcher.mock.calls[0][1], body: fetcher.mock.calls[0][1].body && JSON.parse(fetcher.mock.calls[0][1].body) })

  it('등록은 POST 본문 {kind, body, quote, visibility}에 Bearer·CSRF를 싣고 만든 제보를 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ kind: 'story', quote: '고른 문장', visibility: 'public' }), { status: 201 }))
    const made = await new HttpFeedbackReportRepository(fetcher).create('w1', 3, { kind: 'story', body: '본문', quote: '고른 문장', visibility: 'public' })
    const { url, init, body } = sent(fetcher)
    expect(url).toBe('/api/v1/works/w1/episodes/3/feedback-reports')
    expect(init.method).toBe('POST')
    expect(body).toEqual({ kind: 'story', body: '본문', quote: '고른 문장', visibility: 'public' })
    expect(headers(fetcher).get('Authorization')).toBe('Bearer report-bearer')
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('report-csrf')
    expect(made).toMatchObject({ kind: 'story', quote: '고른 문장', visibility: 'public' })
  })

  it('공개 범위·정정·작가 답변·상태 변경은 제보 경로로 필요한 본문만 보낸다', async () => {
    const cases: [string, (r: HttpFeedbackReportRepository) => Promise<unknown>, string, string, unknown][] = [
      ['공개 범위', (r) => r.setVisibility('w1', 'r1', 'public'), 'PUT', '/api/v1/works/w1/feedback-reports/r1/visibility', { visibility: 'public' }],
      ['정정', (r) => r.correct('w1', 'r1', '정정'), 'POST', '/api/v1/works/w1/feedback-reports/r1/corrections', { body: '정정' }],
      ['답변', (r) => r.answer('w1', 'r1', { body: '답변', isPublic: true }), 'POST', '/api/v1/works/w1/feedback-reports/r1/responses', { body: '답변', isPublic: true }],
      ['상태', (r) => r.setStatus('w1', 'r1', 'resolved'), 'PUT', '/api/v1/works/w1/feedback-reports/r1/status', { status: 'resolved' }],
    ]
    for (const [label, run, method, path, expected] of cases) {
      const fetcher = vi.fn().mockResolvedValue(Response.json(row({ status: 'resolved' })))
      expect(await run(new HttpFeedbackReportRepository(fetcher)), label).toMatchObject({ id: 'r1' })
      const { url, init, body } = sent(fetcher)
      expect([url, init.method, body], label).toEqual([path, method, expected])
      expect(headers(fetcher).get('X-CSRF-TOKEN'), label).toBe('report-csrf')
    }
  })

  it('철회·확인은 본문 없이 POST로 보내고 갱신된 제보를 돌려준다', async () => {
    for (const [run, path] of [
      [(r: HttpFeedbackReportRepository) => r.withdraw('w1', 'r1'), '/api/v1/works/w1/feedback-reports/r1/withdrawal'],
      [(r: HttpFeedbackReportRepository) => r.check('w1', 'r1'), '/api/v1/works/w1/feedback-reports/r1/check'],
    ] as const) {
      const fetcher = vi.fn().mockResolvedValue(Response.json(row({ withdrawn: true })))
      expect(await run(new HttpFeedbackReportRepository(fetcher))).toMatchObject({ withdrawn: true })
      const { url, init } = sent(fetcher)
      expect([url, init.method, init.body]).toEqual([path, 'POST', undefined])
    }
  })

  it('경로의 ID는 인코딩하고 서버 거절 문구는 그대로 오류로 전한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: '철회한 제보는 정정할 수 없어요.' }, { status: 409 }))
    await expect(new HttpFeedbackReportRepository(fetcher).correct('w/1', 'r 1', '정정')).rejects.toThrow('철회한 제보는 정정할 수 없어요.')
    expect(sent(fetcher).url).toBe('/api/v1/works/w%2F1/feedback-reports/r%201/corrections')
  })
})
