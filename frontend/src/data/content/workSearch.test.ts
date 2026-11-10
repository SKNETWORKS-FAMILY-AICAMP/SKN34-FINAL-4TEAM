import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login, refresh } from '../api/auth'
import { canReport } from '../../domain/entities/work'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'
import { HttpWorkRepository } from './HttpWorkRepository'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'reader', email: 'reader@example.invalid', nickname: 'Reader', operator: false } })))
  await login('reader@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

/** Content 공개 WorkResponse(+최근 24시간 조회 수 views, 공개 좋아요 수 likes) 한 건 */
const dto = (over: object = {}) => ({
  id: 'w1', title: '별빛 서약의 탑', summary: '소개', visibility: 'public', allowFork: true, allowForkPublication: false,
  creationType: 'ORIGINAL', genres: ['판타지', 'SF'], hashtags: ['서약'], source: null, views: 7, likes: 3,
  slug: 'starlight', authorName: '윤서하', ownerId: 'owner-uuid', revision: 0, theme: 'star', hook: '', hanja: null, hero: null, heroBg: null, forkableEpisodes: [],
  episodes: [
    { number: 1, version: 1, versionId: 'v1', title: '첫 화', body: '본문', inherited: false },
    { number: 2, version: 1, versionId: 'v2', title: '둘째 화', body: '본문2', inherited: false },
  ],
  ...over,
})
const query = (url: string) => Object.fromEntries(new URL(url, 'http://localhost').searchParams)

describe('공개 작품 검색 (GET /api/v1/public/works)', () => {
  it('익명 GET으로 검색어·범위·정렬을 보내고 카드 화면의 Work로 바꾼다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([dto()]))
    const [w] = await new HttpEpisodeRepository(fetcher).search({ q: '별빛 #서약', f: 'title', sort: 'view' })
    const [url, init] = fetcher.mock.calls[0]
    expect(new URL(url, 'http://localhost').pathname).toBe('/api/v1/public/works')
    expect(query(url)).toEqual({ q: '별빛 #서약', f: 'title', sort: 'view' })
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
    expect(new Headers(init.headers).has('X-CSRF-TOKEN')).toBe(false)
    // 좋아요 수는 서버 값이고, 서버에 없는 댓글 수·갱신 시각은 자리표시 값이라 statisticsSupported:false로 화면이 감춘다.
    expect(w).toMatchObject({ id: 'w1', title: '별빛 서약의 탑', genre: '판타지 · SF', summary: '소개', kind: '원작', views: 7, likes: 3, cmts: 0, upd: 0, statisticsSupported: false, tags: [], author: '윤서하', hash: ['#서약'], canonical: true })
    expect(w.parent).toBeUndefined()
    expect(w.forkAt).toBeUndefined()
    expect(w.eps.map((e) => e.t)).toEqual(['첫 화', '둘째 화'])
  })

  it('검색 카드의 서버 작품은 남의 공개 작품만 신고할 수 있다 — 내 작품·비공개는 불가 (#196)', async () => {
    const rows = [dto({ id: 'other' }), dto({ id: 'mine', ownerId: 'reader' }), dto({ id: 'closed', visibility: 'private' })]
    const found = await new HttpEpisodeRepository(vi.fn().mockResolvedValue(Response.json(rows))).search({ q: '', f: 'all', sort: 'latest' })
    expect(found.every((w) => w.canonical)).toBe(true)
    expect(found.map((w) => canReport(w, 'reader'))).toEqual([true, false, false])
  })

  it('원작과 Fork는 source 유무로 가르고 기준 회차·분기 방향을 옮긴다', async () => {
    const source = { workId: 'o1', title: '원작', episode: 3, version: 1, direction: '다른 선택을 했다면' }
    const fetcher = vi.fn().mockResolvedValue(Response.json([dto({ id: 'f1', source })]))
    const [w] = await new HttpEpisodeRepository(fetcher).search({ q: '', f: 'all', sort: 'latest' })
    expect(w).toMatchObject({ id: 'f1', parent: 'o1', forkAt: 3, dir: '다른 선택을 했다면', kind: '포크', tags: ['if'] })
  })

  it('작가 범위는 작가 표시명 검색으로 보내고 카드에 작가명을 채운다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([dto()]))
    const [w] = await new HttpEpisodeRepository(fetcher).search({ q: '윤서', f: 'author', sort: 'latest' })
    expect(query(fetcher.mock.calls[0][0])).toEqual({ q: '윤서', f: 'author', sort: 'latest' })
    expect(w.author).toBe('윤서하')
  })

  it('빈 검색어는 보내지 않아 기존 공개 목록과 같은 요청이 된다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([]))
    await expect(new HttpEpisodeRepository(fetcher).search({ q: '', f: 'all', sort: 'latest' })).resolves.toEqual([])
    expect(query(fetcher.mock.calls[0][0])).toEqual({ f: 'all', sort: 'latest' })
  })

  it('인기 순(like)·페이지(page 0부터)·크기(size)를 쿼리로 보낸다 — 첫 페이지의 page=0도 생략하지 않는다', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => Response.json([]))
    const repo = new HttpEpisodeRepository(fetcher)
    await repo.search({ q: '', f: 'all', sort: 'like', page: 0, size: 20 })
    await repo.search({ q: '별빛', f: 'tag', sort: 'view', page: 3, size: 20 })
    expect(fetcher.mock.calls.map(([url]) => query(String(url)))).toEqual([
      { f: 'all', sort: 'like', page: '0', size: '20' },
      { q: '별빛', f: 'tag', sort: 'view', page: '3', size: '20' },
    ])
  })

  it('조회 수가 빠진 응답은 빈 목록으로 숨기지 않고 오류로 알린다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ ...dto(), views: undefined }]))
    await expect(new HttpEpisodeRepository(fetcher).search({ q: '', f: 'all', sort: 'latest' })).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it('좋아요 수가 빠진 응답은 0으로 지어내지 않고 오류로 알린다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ ...dto(), likes: undefined }]))
    await expect(new HttpEpisodeRepository(fetcher).search({ q: '', f: 'all', sort: 'latest' })).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it('서버 검증 오류(422)의 detail을 그대로 알린다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: '지원하지 않는 검색 범위예요.' }, { status: 422 }))
    await expect(new HttpEpisodeRepository(fetcher).search({ q: '', f: 'all', sort: 'latest' })).rejects.toThrow('지원하지 않는 검색 범위예요.')
  })
})

describe('작품 랭킹 (GET /api/v1/public/works/ranking)', () => {
  it.each(['top', 'rising'] as const)('%s 랭킹을 익명 GET으로 조회하고 서버의 24시간 조회 수를 보여 준다', async (kind) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([dto({ views: 12 })]))
    const rows = await new HttpEpisodeRepository(fetcher).ranking(kind)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`/api/v1/public/works/ranking?kind=${kind}`)
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
    expect(rows.map((w) => w.views)).toEqual([12])
    expect(rows.map((w) => w.statisticsSupported)).toEqual([false])
  })

  it('형식이 맞지 않는 응답은 오류로 알린다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: 'bad' }]))
    await expect(new HttpEpisodeRepository(fetcher).ranking('top')).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })
})

describe('조회 기록 (POST /api/v1/works/{id}/episodes/{number}/views)', () => {
  it('로그인 회원은 Bearer·CSRF로 회차 조회를 보내고 204를 성공으로 본다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(new HttpEpisodeRepository(fetcher).recordView('w1', 2)).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w1/episodes/2/views', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      headers: expect.objectContaining({ Authorization: 'Bearer content-bearer', 'X-CSRF-TOKEN': 'content-csrf' }),
    }))
  })

  it('익명 열람은 기록하지 않으며 CSRF 요청도 보내지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
    await refresh().catch(() => {})
    const sent = vi.mocked(fetch).mock.calls.length
    const fetcher = vi.fn()
    await expect(new HttpEpisodeRepository(fetcher).recordView('w1', 1)).resolves.toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls).toHaveLength(sent)
  })

  it('서버가 거절하면 오류를 던진다(삼킬지는 UseCase가 정한다)', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: '공개 회차를 찾을 수 없어요.' }, { status: 404 }))
    await expect(new HttpEpisodeRepository(fetcher).recordView('w1', 9)).rejects.toThrow('공개 회차를 찾을 수 없어요.')
  })
})

describe('검색 카드 → /work/:id 상세', () => {
  it('카드의 id로 같은 서버 작품의 상세를 연다(공개 목록에서 찾고 마지막 회차 기준 세계관을 읽는다)', async () => {
    const fetcher = vi.fn(async (path: RequestInfo | URL) => Response.json(String(path).includes('/world?') ? { workId: 'w1', episode: 2, documents: [] } : [dto()]))
    const api = new HttpEpisodeRepository(fetcher)
    const reading = { getProgress: async () => ({ last: {}, read: {}, seen: {}, liked: {} }), markSeen: async () => {}, saveProgress: async () => {} }
    const records = { list: async () => [], record: async () => {}, remove: async () => {} }
    const useCase = new ReadingUseCase(new HttpWorkRepository(api, () => false), reading, records, api)
    const { list: [card] } = await useCase.findWorks({ sort: 'latest' })
    expect(query(String(fetcher.mock.calls[0][0]))).toEqual({ f: 'all', sort: 'latest', page: '0', size: '20' })
    const detail = await useCase.getWork(card.id, null)
    expect(detail?.work).toMatchObject({ id: card.id, title: '별빛 서약의 탑', author: '윤서하' })
    expect(detail?.visible).toHaveLength(2)
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/public/works/w1/world?episode=2', expect.objectContaining({ method: 'GET' }))
  })
})
