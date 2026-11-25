import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError, OperationsForbidden, OperationsRejected } from '../../domain/entities/operations'
import { login } from './auth'
import { HttpOperationsCardCategoryRepository } from './cardCategoryApi'

const row = { code: 'location', name: '장소', icon: '🏰', active: true, position: 2, cardCount: 7 }
type Call = [string, { method?: string; body?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const failing = (status: number, body?: unknown) => vi.fn(async () => (body === undefined ? new Response(null, { status }) : Response.json(body, { status })))

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'k-csrf' }) : Response.json({ accessToken: 'k-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpOperationsCardCategoryRepository', () => {
  it('목록은 Bearer로 읽고 숨긴 카테고리·카드 수까지 검증해 돌려주며 없는 아이콘은 null이다', async () => {
    const hidden = { ...row, code: 'category-09', name: '마법', icon: '', active: false, position: 9, cardCount: 0 }
    const fetcher = ok([row, hidden])
    expect(await new HttpOperationsCardCategoryRepository(fetcher).list()).toEqual([row, { ...hidden, icon: null }])
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/card-categories')
    expect(init.headers.Authorization).toBe('Bearer k-bearer')
    await expect(new HttpOperationsCardCategoryRepository(ok({ items: [row] })).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.') // 계약은 맨 배열이다
    await expect(new HttpOperationsCardCategoryRepository(ok([{ ...row, cardCount: -1 }])).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it('추가는 POST로 이름·아이콘을, 수정은 PATCH로 바꾼 값만, 순서는 PUT order로 전체 코드를 보낸다', async () => {
    const fetcher = ok(row)
    const repo = new HttpOperationsCardCategoryRepository(fetcher)
    await repo.create({ name: '마법' })
    await repo.create({ name: '마법', icon: '🔮' })
    await repo.update('category-09', { name: '마법 체계' })
    await repo.update('category-09', { icon: '' })
    await repo.update('category-09', { active: false })
    await repo.reorder(['other', 'character'])
    expect(callsOf(fetcher).map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['POST', '/api/v1/operations/card-categories', '{"name":"마법"}'],
      ['POST', '/api/v1/operations/card-categories', '{"name":"마법","icon":"🔮"}'],
      ['PATCH', '/api/v1/operations/card-categories/category-09', '{"name":"마법 체계"}'],
      ['PATCH', '/api/v1/operations/card-categories/category-09', '{"icon":""}'],
      ['PATCH', '/api/v1/operations/card-categories/category-09', '{"active":false}'],
      ['PUT', '/api/v1/operations/card-categories/order', '{"codes":["other","character"]}'],
    ])
  })

  it('이름 중복 409는 서버 code로 한국어 안내를 OperationsRejected로 던지고 모르는 409는 일반 충돌 안내다', async () => {
    const taken = new HttpOperationsCardCategoryRepository(failing(409, { code: 'CARD_CATEGORY_NAME_TAKEN', message: 'Name already exists' }))
    await expect(taken.create({ name: '인물' })).rejects.toThrow(new OperationsRejected('이미 같은 이름의 카드 카테고리가 있어요.'))
    await expect(new HttpOperationsCardCategoryRepository(failing(409, { code: 'CONFLICT', message: 'Conflict' })).update('character', { name: 'x' })).rejects.toThrow('다른 변경과 충돌했어요.')
  })

  it('입력 오류 422는 서버의 한글 안내를 그대로 보이고 영문 고정 문구면 입력값 확인 안내로 바꾼다', async () => {
    const korean = new HttpOperationsCardCategoryRepository(failing(422, { code: 'REQUEST_FAILED', message: '카테고리 이름을 1~30자로 적어 주세요.' }))
    await expect(korean.create({ name: '마법' })).rejects.toThrow(new OperationsRejected('카테고리 이름을 1~30자로 적어 주세요.'))
    const english = new HttpOperationsCardCategoryRepository(failing(422, { code: 'REQUEST_FAILED', message: 'Request failed' }))
    await expect(english.update('character', { name: '인물' })).rejects.toThrow(new OperationsError('입력값을 확인해 주세요.'))
  })

  it('403은 OperationsForbidden이고 404·순서 422·502는 상태별 한국어 안내(OperationsError)다', async () => {
    await expect(new HttpOperationsCardCategoryRepository(failing(403)).list()).rejects.toBeInstanceOf(OperationsForbidden)
    await expect(new HttpOperationsCardCategoryRepository(failing(404, { code: 'NOT_FOUND', message: 'Not found' })).update('zzz', { active: false })).rejects.toThrow(new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'))
    await expect(new HttpOperationsCardCategoryRepository(failing(422, { code: 'REQUEST_FAILED', message: 'Bad order' })).reorder(['character'])).rejects.toThrow(new OperationsError('순서가 목록과 맞지 않아요. 목록을 새로고침한 뒤 다시 시도해 주세요.'))
    await expect(new HttpOperationsCardCategoryRepository(failing(502)).create({ name: '마법' })).rejects.toThrow(new OperationsError('연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.'))
  })
})
