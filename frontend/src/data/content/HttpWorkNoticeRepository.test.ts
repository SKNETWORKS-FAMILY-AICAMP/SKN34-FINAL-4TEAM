import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login, refresh } from '../api/auth'
import { HttpWorkNoticeRepository } from './HttpWorkNoticeRepository'

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'n1', workId: 'w1', category: 'info', title: '연재 일정 안내', body: '본문\n둘째 줄', pinned: false,
  createdAt: '2026-11-11T01:23:45Z', updatedAt: '2026-11-11T01:23:45Z', ...extra,
})
const input = { category: 'hiatus' as const, title: '휴재 안내', body: '이번 주는 쉬어요.', pinned: true }
const headers = (fetcher: ReturnType<typeof vi.fn>, call = 0) => new Headers(fetcher.mock.calls[call][1].headers)

const signIn = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'notice-csrf' })
    : Response.json({ accessToken: 'notice-bearer', user: { id: 'owner', email: 'owner@example.invalid', nickname: '작가', operator: false } })))
  await login('owner@example.invalid', 'test-password')
}
const signOut = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
  await refresh().catch(() => {})
}

afterEach(() => vi.unstubAllGlobals())

describe('작품 소식 읽기 (공개 API, 익명 허용)', () => {
  it('익명이면 Authorization·CSRF 없이 공개 경로로 읽고 서버가 준 순서를 그대로 돌려준다', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [row({ id: 'a', pinned: true }), row({ id: 'b', category: 'event' }), row({ id: 'c', category: 'hiatus' })] }))
    const found = await new HttpWorkNoticeRepository(fetcher).list('w 1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/public/works/w%201/notices', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).has('Authorization')).toBe(false)
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
    expect(found.map((n) => [n.id, n.category, n.pinned])).toEqual([['a', 'info', true], ['b', 'event', false], ['c', 'hiatus', false]])
    expect(found[0]).toEqual(row({ id: 'a', pinned: true }))
  })

  it('로그인 상태여도 공개 목록에는 Bearer를 싣지 않는다 (회원별 필드가 없다)', async () => {
    await signIn()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] }))
    expect(await new HttpWorkNoticeRepository(fetcher).list('w1')).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(headers(fetcher).has('Authorization')).toBe(false)
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
  })

  it('화면을 떠날 때 보내는 취소 신호를 요청에 이어 준다', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] }))
    const leave = new AbortController()
    await new HttpWorkNoticeRepository(fetcher).list('w1', leave.signal)
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false)
    leave.abort()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
})

describe('작품 소식 쓰기 (회원, CSRF)', () => {
  beforeEach(signIn)
  const sent = (fetcher: ReturnType<typeof vi.fn>) => ({ url: fetcher.mock.calls[0][0], init: fetcher.mock.calls[0][1], body: fetcher.mock.calls[0][1].body && JSON.parse(fetcher.mock.calls[0][1].body) })

  it('작성은 POST 본문 {category,title,body,pinned}에 Bearer·CSRF를 싣고 201로 만든 소식을 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ ...input, id: 'n9' }), { status: 201, headers: { Location: '/api/v1/works/w1/notices/n9' } }))
    const made = await new HttpWorkNoticeRepository(fetcher).create('w1', input)
    const { url, init, body } = sent(fetcher)
    expect([url, init.method]).toEqual(['/api/v1/works/w1/notices', 'POST'])
    expect(body).toEqual(input)
    expect(headers(fetcher).get('Authorization')).toBe('Bearer notice-bearer')
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('notice-csrf')
    expect(made).toMatchObject({ id: 'n9', category: 'hiatus', title: '휴재 안내', pinned: true })
  })

  it('본문의 줄바꿈·빈 줄은 요청 JSON에도 응답에도 그대로 실린다', async () => {
    const body = '첫 줄입니다.\n화·금에 올라와요.\n\n마지막 줄'
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ body }), { status: 201 }))
    const made = await new HttpWorkNoticeRepository(fetcher).create('w1', { ...input, body })
    expect(fetcher.mock.calls[0][1].body).toContain('\\n')
    expect(sent(fetcher).body.body).toBe(body)
    expect(made.body).toBe(body)
  })

  it('수정은 PUT으로 전체 본문(고정 여부 포함)을 보내고 고친 소식을 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ ...input, updatedAt: '2026-11-11T02:00:00Z' })))
    const edited = await new HttpWorkNoticeRepository(fetcher).update('w1', 'n1', input)
    const { url, init, body } = sent(fetcher)
    expect([url, init.method, body]).toEqual(['/api/v1/works/w1/notices/n1', 'PUT', input])
    expect(headers(fetcher).get('Authorization')).toBe('Bearer notice-bearer')
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('notice-csrf')
    expect(edited).toMatchObject({ id: 'n1', title: '휴재 안내', updatedAt: '2026-11-11T02:00:00Z' })
  })

  it('삭제는 204를 받아 DELETE로 보내고 본문 없이 끝난다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(new HttpWorkNoticeRepository(fetcher).remove('w1', 'n1')).resolves.toBeUndefined()
    const { url, init, body } = sent(fetcher)
    expect([url, init.method, body]).toEqual(['/api/v1/works/w1/notices/n1', 'DELETE', undefined])
    expect(headers(fetcher).get('Authorization')).toBe('Bearer notice-bearer')
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('notice-csrf')
  })

  it('삭제 응답이 204가 아니면 삭제로 확정하지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    await expect(new HttpWorkNoticeRepository(fetcher).remove('w1', 'n1')).rejects.toThrow('삭제 완료 응답')
  })

  it('작품·소식 id는 경로에 맞게 인코딩한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await new HttpWorkNoticeRepository(fetcher).remove('w 1', 'n/1')
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/works/w%201/notices/n%2F1')
  })

  it('쓰기에도 화면 이탈 취소 신호를 이어 준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row(), { status: 201 }))
    const leave = new AbortController()
    await new HttpWorkNoticeRepository(fetcher).create('w1', input, leave.signal)
    leave.abort()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
})

describe('작품 소식 오류와 응답 검증', () => {
  beforeEach(signIn)

  it.each([
    ['권한 없음(403)', 403, '작품 소식을 관리할 권한이 없어요.'],
    ['입력 검증 실패(422)', 422, '소식 제목은 1~200자여야 해요.'],
    ['없는 소식(404)', 404, '소식을 찾을 수 없어요.'],
  ])('서버 detail을 그대로 전달한다 — %s', async (_name, status, detail) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail }, { status }))
    await expect(new HttpWorkNoticeRepository(fetcher).update('w1', 'n1', input)).rejects.toThrow(detail)
  })

  it('detail 없는 오류는 읽을 수 있는 기본 문구로 알린다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(new HttpWorkNoticeRepository(fetcher).create('w1', input)).rejects.toThrow('요청을 처리하지 못했어요.')
  })

  it.each([
    ['알 수 없는 분류', row({ category: 'notice' })],
    ['필수 필드 누락', row({ pinned: undefined })],
    ['문자열 고정 여부', row({ pinned: 'true' })],
    ['잘못된 시각', row({ createdAt: '어제' })],
    ['숫자 id', row({ id: 1 })],
  ])('Zod가 %s 응답을 거절한다 (빈 목록으로 숨기지 않는다)', async (_name, bad) => {
    const repo = new HttpWorkNoticeRepository(vi.fn().mockResolvedValue(Response.json({ items: [row(), bad] })))
    await expect(repo.list('w1')).rejects.toThrow('서버 응답 형식')
  })

  it('목록이 items 배열이 아니면 거절한다', async () => {
    await expect(new HttpWorkNoticeRepository(vi.fn().mockResolvedValue(Response.json([row()]))).list('w1')).rejects.toThrow('서버 응답 형식')
  })

  it('작성·수정 응답이 소식이 아니거나 본문 없는 204면 성공으로 확정하지 않는다', async () => {
    for (const response of [() => Response.json({ id: 'n1' }, { status: 201 }), () => new Response(null, { status: 204 })]) {
      const repo = new HttpWorkNoticeRepository(vi.fn(async () => response()))
      await expect(repo.create('w1', input)).rejects.toThrow('서버 응답 형식')
      await expect(repo.update('w1', 'n1', input)).rejects.toThrow('서버 응답 형식')
    }
  })
})
