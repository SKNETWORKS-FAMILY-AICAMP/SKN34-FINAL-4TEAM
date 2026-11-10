import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { HttpEditSuggestionRepository } from './HttpEditSuggestionRepository'

const row = (extra: Record<string, unknown> = {}) => ({
  id: 's1', workId: 'w1', workTitle: '별빛 서약', episodeNumber: 3, publishedVersionId: 'v1', source: 'reader', proposerName: '독자',
  beforeText: '않 된다고', afterText: '안 된다고', editedText: null, reason: null, status: 'pending', decisionReason: null,
  applyResult: null, applyFailure: null, appliedVersionId: null, scope: 'auto', scopeReasons: ['띄어쓰기·문장부호만 바뀌어요.'],
  mine: true, owner: false, createdAt: '2026-11-10T01:23:45Z', updatedAt: '2026-11-10T01:23:45Z', ...extra,
})
const headers = (fetcher: ReturnType<typeof vi.fn>, call = 0) => new Headers(fetcher.mock.calls[call][1].headers)
const sent = (fetcher: ReturnType<typeof vi.fn>) => ({ url: fetcher.mock.calls[0][0], init: fetcher.mock.calls[0][1], body: fetcher.mock.calls[0][1].body && JSON.parse(fetcher.mock.calls[0][1].body) })

afterEach(() => vi.unstubAllGlobals())
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'suggest-csrf' })
    : Response.json({ accessToken: 'suggest-bearer', user: { id: 'reader', email: 'reader@example.invalid', nickname: '독자', operator: false } })))
  await login('reader@example.invalid', 'test-password')
})

describe('수정 제안 읽기 (회원, Bearer)', () => {
  it('내 제안 목록은 Bearer로 읽고 items를 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [row(), row({ id: 's2', status: 'approved', applyResult: 'applied', appliedVersionId: 'v9' })] }))
    const items = await new HttpEditSuggestionRepository(fetcher).mine()
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/edit-suggestions/mine', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).get('Authorization')).toBe('Bearer suggest-bearer')
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
    expect(items.map((i) => [i.id, i.status, i.applyResult])).toEqual([['s1', 'pending', null], ['s2', 'approved', 'applied']])
  })

  it('작가 피드백함 목록은 inbox 경로를 읽는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [row({ owner: true, mine: false })] }))
    const [first] = await new HttpEditSuggestionRepository(fetcher).inbox()
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/works/edit-suggestions/inbox')
    expect(first).toMatchObject({ owner: true, mine: false, scope: 'auto', scopeReasons: ['띄어쓰기·문장부호만 바뀌어요.'] })
  })
})

describe('수정 제안 쓰기 (회원, CSRF)', () => {
  it('등록은 POST 본문 {beforeText, afterText, reason}에 Bearer·CSRF를 싣고 만든 제안을 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ reason: '맞춤법' }), { status: 201 }))
    const made = await new HttpEditSuggestionRepository(fetcher).create('w1', 3, { beforeText: '않 된다고', afterText: '안 된다고', reason: '맞춤법' })
    const { url, init, body } = sent(fetcher)
    expect([url, init.method, body]).toEqual(['/api/v1/works/w1/episodes/3/edit-suggestions', 'POST', { beforeText: '않 된다고', afterText: '안 된다고', reason: '맞춤법' }])
    expect(headers(fetcher).get('Authorization')).toBe('Bearer suggest-bearer')
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('suggest-csrf')
    expect(made).toMatchObject({ id: 's1', reason: '맞춤법', status: 'pending', mine: true })
  })

  it('사유가 없으면 reason을 보내지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row(), { status: 201 }))
    await new HttpEditSuggestionRepository(fetcher).create('w1', 3, { beforeText: '않 된다고', afterText: '안 된다고' })
    expect(sent(fetcher).body).toEqual({ beforeText: '않 된다고', afterText: '안 된다고' })
  })

  it('편집안 저장은 PUT edited-text에 {editedText}만 보낸다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ editedText: '안 된다고요' })))
    const saved = await new HttpEditSuggestionRepository(fetcher).saveEditedText('w1', 's1', '안 된다고요')
    const { url, init, body } = sent(fetcher)
    expect([url, init.method, body]).toEqual(['/api/v1/works/w1/edit-suggestions/s1/edited-text', 'PUT', { editedText: '안 된다고요' }])
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('suggest-csrf')
    expect(saved.editedText).toBe('안 된다고요')
  })

  it.each([
    ['approve', 'approval'],
    ['hold', 'hold'],
  ] as const)('%s는 본문 없이 %s 하위 경로를 POST한다', async (action, path) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ status: action === 'hold' ? 'held' : 'approved', applyResult: action === 'hold' ? null : 'applied' })))
    await new HttpEditSuggestionRepository(fetcher)[action]('w1', 's1')
    const { url, init, body } = sent(fetcher)
    expect([url, init.method, body]).toEqual([`/api/v1/works/w1/edit-suggestions/s1/${path}`, 'POST', undefined])
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('suggest-csrf')
  })

  it('승인 응답은 반영 결과와 실패 사유를 담는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row({ status: 'approved', applyResult: 'failed', applyFailure: '초안에서 고칠 문장을 찾을 수 없어요.' })))
    expect(await new HttpEditSuggestionRepository(fetcher).approve('w1', 's1')).toMatchObject({ status: 'approved', applyResult: 'failed', applyFailure: '초안에서 고칠 문장을 찾을 수 없어요.', appliedVersionId: null })
  })

  it('거절은 사유가 있으면 {reason}, 없으면 빈 객체를 보낸다', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(row({ status: 'rejected', decisionReason: '톤이 달라요' })))
    const repo = new HttpEditSuggestionRepository(fetcher)
    await repo.reject('w1', 's1', '톤이 달라요')
    await repo.reject('w1', 's1')
    expect([fetcher.mock.calls[0][0], fetcher.mock.calls[0][1].method, JSON.parse(fetcher.mock.calls[0][1].body)]).toEqual(['/api/v1/works/w1/edit-suggestions/s1/rejection', 'POST', { reason: '톤이 달라요' }])
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({})
  })

  it('경로의 작품·제안 ID는 인코딩한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row()))
    await new HttpEditSuggestionRepository(fetcher).hold('w/1', 's 1')
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/works/w%2F1/edit-suggestions/s%201/hold')
  })
})

describe('수정 제안 응답 검증', () => {
  // 서버 detail 전달·기본 오류 문구는 공용 request 동작이라 HttpEpisodeCommentRepository 테스트가 이미 검증한다.
  it('Zod가 모르는 상태 값이 든 응답을 거절한다', async () => {
    const repo = new HttpEditSuggestionRepository(vi.fn().mockImplementation(async () => Response.json({ items: [row(), row({ status: 'done' })] })))
    await expect(repo.inbox()).rejects.toThrow('서버 응답 형식')
  })

  it('목록이 items 배열이 아니면 거절한다', async () => {
    await expect(new HttpEditSuggestionRepository(vi.fn().mockResolvedValue(Response.json([row()]))).mine()).rejects.toThrow('서버 응답 형식')
  })
})
