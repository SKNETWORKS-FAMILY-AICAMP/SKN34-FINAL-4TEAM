import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError, OperationsForbidden, OperationsRejected } from '../../domain/entities/operations'
import { login } from './auth'
import { HttpOperationsGenreRepository } from './genreApi'

const row = { code: 'genre-31', name: '사극', emoji: '🎬', active: true, featured: false, position: 31, workCount: 2, worldCount: 0 }
type Call = [string, { method?: string; body?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const failing = (status: number, body?: unknown) => vi.fn(async () => (body === undefined ? new Response(null, { status }) : Response.json(body, { status })))

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'g-csrf' }) : Response.json({ accessToken: 'g-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpOperationsGenreRepository', () => {
  it('목록은 Bearer로 읽고 숨긴 장르·사용 수까지 검증해 돌려주며 없는 아이콘은 null이다', async () => {
    const hidden = { ...row, code: 'genre-32', name: '숨김', emoji: '', active: false, position: 32 }
    const fetcher = ok([row, hidden])
    expect(await new HttpOperationsGenreRepository(fetcher).list()).toEqual([row, { ...hidden, emoji: null }])
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/genres')
    expect(init.headers.Authorization).toBe('Bearer g-bearer')
    await expect(new HttpOperationsGenreRepository(ok({ items: [row] })).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.') // 계약은 배열이다
  })

  it('형식이 다른 목록은 던진다', async () => {
    await expect(new HttpOperationsGenreRepository(ok([{ ...row, workCount: -1 }])).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it('추가는 POST로 이름·아이콘을, 수정은 PATCH로 바꾼 값만, 순서는 PUT order로 전체 코드를 보낸다', async () => {
    const fetcher = ok(row)
    const repo = new HttpOperationsGenreRepository(fetcher)
    await repo.create({ name: '사극' })
    await repo.create({ name: '사극', emoji: '🎬' })
    await repo.update('genre-31', { name: '정통 사극' })
    await repo.update('genre-31', { emoji: '' })
    await repo.update('genre-31', { active: false })
    await repo.update('genre-31', { featured: true })
    await repo.reorder(['genre-02', 'genre-01'])
    expect(callsOf(fetcher).map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['POST', '/api/v1/operations/genres', '{"name":"사극"}'],
      ['POST', '/api/v1/operations/genres', '{"name":"사극","emoji":"🎬"}'],
      ['PATCH', '/api/v1/operations/genres/genre-31', '{"name":"정통 사극"}'],
      ['PATCH', '/api/v1/operations/genres/genre-31', '{"emoji":""}'],
      ['PATCH', '/api/v1/operations/genres/genre-31', '{"active":false}'],
      ['PATCH', '/api/v1/operations/genres/genre-31', '{"featured":true}'],
      ['PUT', '/api/v1/operations/genres/order', '{"codes":["genre-02","genre-01"]}'],
    ])
  })

  it('이름 중복·홈 노출 한도 409는 서버 code로 한국어 안내를 OperationsRejected로 던진다', async () => {
    const taken = new HttpOperationsGenreRepository(failing(409, { code: 'GENRE_NAME_TAKEN', message: 'Genre name already exists' }))
    await expect(taken.create({ name: '판타지' })).rejects.toThrow(new OperationsRejected('이미 같은 이름의 장르가 있어요.'))
    const limit = new HttpOperationsGenreRepository(failing(409, { code: 'GENRE_FEATURED_LIMIT', message: 'Featured limit' }))
    await expect(limit.update('genre-05', { featured: true })).rejects.toThrow(new OperationsRejected('홈에 보이는 장르는 최대 6개예요. 다른 장르의 홈 노출을 먼저 꺼 주세요.'))
    // 모르는 409는 일반 충돌 안내다.
    await expect(new HttpOperationsGenreRepository(failing(409, { code: 'CONFLICT', message: 'Conflict' })).update('genre-05', { name: 'x' })).rejects.toThrow('다른 변경과 충돌했어요.')
  })

  it('입력 오류 422는 서버(Content)의 한글 안내를 그대로 보이고 영문 고정 문구면 입력값 확인 안내로 바꾼다', async () => {
    const korean = new HttpOperationsGenreRepository(failing(422, { code: 'REQUEST_FAILED', message: '장르 이름을 1~30자로 적어 주세요.' }))
    await expect(korean.create({ name: '사극' })).rejects.toThrow(new OperationsRejected('장르 이름을 1~30자로 적어 주세요.'))
    const english = new HttpOperationsGenreRepository(failing(422, { code: 'REQUEST_FAILED', message: 'Request failed' }))
    await expect(english.update('genre-31', { name: '사극' })).rejects.toThrow(new OperationsError('입력값을 확인해 주세요.'))
  })

  it('403은 OperationsForbidden이고 404·422·502는 상태별 한국어 안내(OperationsError)다', async () => {
    await expect(new HttpOperationsGenreRepository(failing(403)).list()).rejects.toBeInstanceOf(OperationsForbidden)
    await expect(new HttpOperationsGenreRepository(failing(404, { code: 'NOT_FOUND', message: 'Not found' })).update('genre-99', { active: false })).rejects.toThrow(new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'))
    await expect(new HttpOperationsGenreRepository(failing(422, { code: 'REQUEST_FAILED', message: 'Bad order' })).reorder(['genre-01'])).rejects.toThrow(new OperationsError('순서가 목록과 맞지 않아요. 목록을 새로고침한 뒤 다시 시도해 주세요.'))
    await expect(new HttpOperationsGenreRepository(failing(502)).create({ name: '사극' })).rejects.toThrow('연결된 서비스에서 처리하지 못해')
  })
})
