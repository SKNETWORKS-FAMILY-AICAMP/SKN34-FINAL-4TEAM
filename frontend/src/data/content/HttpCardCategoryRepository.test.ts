import { describe, expect, it, vi } from 'vitest'

import { HttpCardCategoryRepository } from './HttpCardCategoryRepository'

const rows = [
  { code: 'character', name: '인물', icon: '🧑', position: 1, active: true },
  { code: 'category-09', name: '마법', icon: null, position: 9, active: false },
]
type Call = [string, RequestInit]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]

describe('HttpCardCategoryRepository', () => {
  it('공개 카드 카테고리 목록은 Bearer 없이 GET으로 읽고 숨긴 것까지(active 플래그) 그대로 돌려준다', async () => {
    const fetcher = vi.fn(async () => Response.json(rows))
    expect(await new HttpCardCategoryRepository(fetcher).list()).toEqual(rows)
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/public/card-categories')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('비었거나 없는 아이콘은 null로 읽고 items로 감싼 응답·active 없는 행은 형식 오류다', async () => {
    const odd = [{ code: 'object', name: '사물', icon: '', position: 5, active: true }, { code: 'other', name: '기타', position: 8, active: true }]
    expect(await new HttpCardCategoryRepository(vi.fn(async () => Response.json(odd))).list()).toEqual([
      { code: 'object', name: '사물', icon: null, position: 5, active: true },
      { code: 'other', name: '기타', icon: null, position: 8, active: true },
    ])
    const format = '서버 응답 형식을 확인할 수 없어요.'
    await expect(new HttpCardCategoryRepository(vi.fn(async () => Response.json({ items: rows }))).list()).rejects.toThrow(format)
    await expect(new HttpCardCategoryRepository(vi.fn(async () => Response.json([{ code: 'object', name: '사물', position: 5 }]))).list()).rejects.toThrow(format)
  })

  it('실패 응답은 빈 목록으로 숨기지 않고 던지며 취소 신호를 요청에 이어 준다', async () => {
    await expect(new HttpCardCategoryRepository(vi.fn(async () => Response.json({}, { status: 502 }))).list()).rejects.toThrow('카드 카테고리를 불러오지 못했어요.')
    const fetcher = vi.fn(async () => Response.json([]))
    const controller = new AbortController()
    await new HttpCardCategoryRepository(fetcher).list(controller.signal)
    controller.abort()
    expect(callsOf(fetcher)[0][1].signal?.aborted).toBe(true)
  })
})
