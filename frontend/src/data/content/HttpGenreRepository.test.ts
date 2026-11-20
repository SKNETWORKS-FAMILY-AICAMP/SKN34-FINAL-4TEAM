import { describe, expect, it, vi } from 'vitest'

import { HttpGenreRepository } from './HttpGenreRepository'

const rows = [{ code: 'genre-01', name: '판타지', emoji: '✨', featured: true }, { code: 'genre-02', name: '현대판타지', emoji: null, featured: false }]
type Call = [string, RequestInit]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]

describe('HttpGenreRepository', () => {
  it('공개 장르 목록은 Bearer 없이 GET으로 읽고 코드·이름·아이콘·홈 노출을 그대로 돌려준다', async () => {
    const fetcher = vi.fn(async () => Response.json(rows))
    expect(await new HttpGenreRepository(fetcher).list()).toEqual(rows)
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/public/genres')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('비었거나 없는 아이콘은 null로 읽고 계약(배열)과 다른 모양(items로 감싼 응답)은 형식 오류다', async () => {
    const rows = [{ code: 'genre-03', name: '무협', emoji: '', featured: false }, { code: 'genre-04', name: '선협', featured: true }]
    await expect(new HttpGenreRepository(vi.fn(async () => Response.json({ items: rows }))).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    const fetcher = vi.fn(async () => Response.json(rows))
    expect(await new HttpGenreRepository(fetcher).list()).toEqual([
      { code: 'genre-03', name: '무협', emoji: null, featured: false },
      { code: 'genre-04', name: '선협', emoji: null, featured: true },
    ])
  })

  it('형식이 다른 응답과 실패 응답은 빈 목록으로 숨기지 않고 던진다', async () => {
    await expect(new HttpGenreRepository(vi.fn(async () => Response.json([{ code: 'genre-01' }]))).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    await expect(new HttpGenreRepository(vi.fn(async () => Response.json({ detail: '장애' }, { status: 502 }))).list()).rejects.toThrow('장르를 불러오지 못했어요.')
  })

  it('취소 신호를 요청에 이어 준다', async () => {
    const fetcher = vi.fn(async () => Response.json([]))
    const controller = new AbortController()
    await new HttpGenreRepository(fetcher).list(controller.signal)
    controller.abort()
    expect(callsOf(fetcher)[0][1].signal?.aborted).toBe(true)
  })
})
