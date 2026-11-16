import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login, refresh } from '../api/auth'
import { HttpEpisodeCommentRepository } from './HttpEpisodeCommentRepository'

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'c1', workId: 'w1', episodeNumber: 3, publishedVersionId: 'v1', authorName: '닉네임', body: '본문', quote: null, spoiler: false,
  likeCount: 2, liked: false, mine: false, edited: false, createdAt: '2026-11-09T01:23:45Z', updatedAt: '2026-11-09T01:23:45Z', ...extra,
})
const headers = (fetcher: ReturnType<typeof vi.fn>, call = 0) => new Headers(fetcher.mock.calls[call][1].headers)

const signIn = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'comment-csrf' })
    : Response.json({ accessToken: 'comment-bearer', user: { id: 'reader', email: 'reader@example.invalid', nickname: '독자', operator: false } })))
  await login('reader@example.invalid', 'test-password')
}
const signOut = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
  await refresh().catch(() => {})
}

afterEach(() => vi.unstubAllGlobals())

describe('회차 댓글 읽기 (공개 API, Bearer 선택)', () => {
  it('로그인 상태면 공개 목록에도 Bearer를 보내 mine·liked를 받고 정렬을 쿼리로 보낸다', async () => {
    await signIn()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [row({ mine: true, liked: true })] }))
    const [first] = await new HttpEpisodeCommentRepository(fetcher).list('w1', 3, 'likes')
    expect(fetcher).toHaveBeenCalledWith('/api/v1/public/works/w1/episodes/3/comments?sort=likes', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).get('Authorization')).toBe('Bearer comment-bearer')
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
    expect(first).toMatchObject({ id: 'c1', authorName: '닉네임', quote: null, likeCount: 2, mine: true, liked: true })
  })

  it('운영 숨김 댓글은 hidden을 그대로 받고, hidden이 없는 이전 응답은 숨기지 않은 댓글로 본다', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [row({ id: 'h', hidden: true, body: '', quote: null }), row({ id: 'v', hidden: false }), row({ id: 'old' })] }))
    const rows = await new HttpEpisodeCommentRepository(fetcher).list('w1', 3, 'latest')
    expect(rows.map((r) => [r.id, r.hidden])).toEqual([['h', true], ['v', false], ['old', false]])
    expect(rows[0]).toMatchObject({ body: '', quote: null, likeCount: 2, authorName: '닉네임' })
  })

  it('익명이면 Authorization 없이 읽는다', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] }))
    expect(await new HttpEpisodeCommentRepository(fetcher).list('w1', 3, 'latest')).toEqual([])
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/works/w1/episodes/3/comments?sort=latest')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(headers(fetcher).has('Authorization')).toBe(false)
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
  })
})

describe('작품 전체 댓글 읽기 (공개 API, Bearer 선택)', () => {
  it('로그인 상태면 Bearer를 보내고 작품 id와 정렬을 경로·쿼리로 보낸다(회차 번호는 응답에 있다)', async () => {
    await signIn()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [row({ id: 'a', episodeNumber: 2, liked: true }), row({ id: 'b', episodeNumber: 5, likeCount: 9 })] }))
    const found = await new HttpEpisodeCommentRepository(fetcher).listByWork('w 1', 'likes')
    expect(fetcher).toHaveBeenCalledWith('/api/v1/public/works/w%201/comments?sort=likes', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).get('Authorization')).toBe('Bearer comment-bearer')
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
    expect(found.map((c) => [c.id, c.episodeNumber, c.likeCount, c.hidden])).toEqual([['a', 2, 2, false], ['b', 5, 9, false]])
  })

  it('익명이면 Authorization 없이 읽고 빈 목록은 빈 배열이다', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] }))
    expect(await new HttpEpisodeCommentRepository(fetcher).listByWork('w1', 'latest')).toEqual([])
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/works/w1/comments?sort=latest')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(headers(fetcher).has('Authorization')).toBe(false)
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
  })

  it('응답 형식이 계약과 다르면 빈 목록으로 숨기지 않고 던진다', async () => {
    await signOut()
    const bad = [{ items: [row({ likeCount: -1 })] }, { items: [row({ episodeNumber: 0 })] }, { items: [{ id: 'x' }] }, [row()]]
    for (const body of bad) {
      await expect(new HttpEpisodeCommentRepository(vi.fn().mockResolvedValue(Response.json(body))).listByWork('w1', 'latest')).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    }
  })

  it('서버가 거절하면 서버 안내 문구로 던진다(공개 작품이 아니면 404)', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: '공개 작품을 찾을 수 없어요.' }, { status: 404 }))
    await expect(new HttpEpisodeCommentRepository(fetcher).listByWork('w1', 'latest')).rejects.toThrow('공개 작품을 찾을 수 없어요.')
  })
})

describe('회차 댓글 쓰기 (회원, CSRF)', () => {
  beforeEach(signIn)
  const sent = (fetcher: ReturnType<typeof vi.fn>) => ({ url: fetcher.mock.calls[0][0], init: fetcher.mock.calls[0][1], body: fetcher.mock.calls[0][1].body && JSON.parse(fetcher.mock.calls[0][1].body) })

  it('작성은 POST 본문 {body, quote, spoiler}에 Bearer·CSRF를 싣고 만든 댓글을 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ body: '안녕', quote: '선택 문장', spoiler: true, mine: true }), { status: 201 }))
    const made = await new HttpEpisodeCommentRepository(fetcher).create('w1', 3, { body: '안녕', quote: '선택 문장', spoiler: true })
    const { url, init, body } = sent(fetcher)
    expect(url).toBe('/api/v1/works/w1/episodes/3/comments')
    expect(init.method).toBe('POST')
    expect(body).toEqual({ body: '안녕', quote: '선택 문장', spoiler: true })
    expect(headers(fetcher).get('Authorization')).toBe('Bearer comment-bearer')
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('comment-csrf')
    expect(made).toMatchObject({ body: '안녕', quote: '선택 문장', spoiler: true, mine: true })
  })

  it('인용이 없으면 quote를 보내지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row(), { status: 201 }))
    await new HttpEpisodeCommentRepository(fetcher).create('w1', 3, { body: '안녕' })
    expect(sent(fetcher).body).toEqual({ body: '안녕' })
  })

  it('수정은 PUT 본문 {body, spoiler}만 보낸다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ body: '고침', edited: true, mine: true })))
    const edited = await new HttpEpisodeCommentRepository(fetcher).update('w1', 3, 'c1', { body: '고침', spoiler: true })
    const { url, init, body } = sent(fetcher)
    expect([url, init.method, body]).toEqual(['/api/v1/works/w1/episodes/3/comments/c1', 'PUT', { body: '고침', spoiler: true }])
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('comment-csrf')
    expect(edited.edited).toBe(true)
  })

  it('삭제는 204를 받아 DELETE로 보낸다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(new HttpEpisodeCommentRepository(fetcher).remove('w1', 3, 'c1')).resolves.toBeUndefined()
    expect([sent(fetcher).url, sent(fetcher).init.method]).toEqual(['/api/v1/works/w1/episodes/3/comments/c1', 'DELETE'])
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('comment-csrf')
  })

  it('삭제 응답이 204가 아니면 삭제로 확정하지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    await expect(new HttpEpisodeCommentRepository(fetcher).remove('w1', 3, 'c1')).rejects.toThrow('삭제 완료 응답')
  })

  it.each([
    ['like', 'PUT'],
    ['unlike', 'DELETE'],
  ] as const)('%s는 like 하위 경로를 %s로 호출하고 204를 기다린다', async (action, method) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(new HttpEpisodeCommentRepository(fetcher)[action]('w1', 3, 'c1')).resolves.toBeUndefined()
    expect([sent(fetcher).url, sent(fetcher).init.method]).toEqual(['/api/v1/works/w1/episodes/3/comments/c1/like', method])
    expect(headers(fetcher).get('Authorization')).toBe('Bearer comment-bearer')
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('comment-csrf')
  })
})

describe('회차 댓글 오류와 응답 검증', () => {
  beforeEach(signIn)

  it('서버 detail을 그대로 전달한다(타인 수정·검증 실패 등)', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: '작성자만 수정할 수 있어요.' }, { status: 403 }))
    await expect(new HttpEpisodeCommentRepository(fetcher).update('w1', 3, 'c1', { body: 'x', spoiler: false })).rejects.toThrow('작성자만 수정할 수 있어요.')
  })

  it('detail 없는 오류는 읽을 수 있는 기본 문구로 알린다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(new HttpEpisodeCommentRepository(fetcher).list('w1', 3, 'latest')).rejects.toThrow('요청을 처리하지 못했어요.')
  })

  it.each([
    ['필수 필드 누락', row({ likeCount: undefined })],
    ['잘못된 시각', row({ createdAt: '어제' })],
    ['문자열 좋아요 수', row({ likeCount: '2' })],
    ['불리언이 아닌 숨김 여부', row({ hidden: 'yes' })],
  ])('Zod가 %s 응답을 거절한다', async (_name, bad) => {
    const repo = new HttpEpisodeCommentRepository(vi.fn().mockResolvedValue(Response.json({ items: [row(), bad] })))
    await expect(repo.list('w1', 3, 'latest')).rejects.toThrow('서버 응답 형식')
  })

  it('목록이 items 배열이 아니면 거절한다', async () => {
    await expect(new HttpEpisodeCommentRepository(vi.fn().mockResolvedValue(Response.json([row()]))).list('w1', 3, 'latest')).rejects.toThrow('서버 응답 형식')
  })
})
