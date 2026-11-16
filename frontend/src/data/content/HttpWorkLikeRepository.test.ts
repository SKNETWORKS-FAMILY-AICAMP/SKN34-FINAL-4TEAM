import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { HttpWorkLikeRepository } from './HttpWorkLikeRepository'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'like-csrf' })
    : Response.json({ accessToken: 'like-bearer', user: { id: 'reader', email: 'reader@example.invalid', nickname: 'Reader', operator: false } })))
  await login('reader@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('작품 좋아요 HTTP 계약 (PUT·DELETE /api/v1/works/{id}/like)', () => {
  it('좋아요 누르기는 Bearer·CSRF로 PUT하고 서버가 확정한 수와 상태를 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ likes: 4, liked: true }))
    await expect(new HttpWorkLikeRepository(fetcher).like('w1')).resolves.toEqual({ likes: 4, liked: true })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w1/like', expect.objectContaining({
      method: 'PUT', credentials: 'same-origin',
      headers: expect.objectContaining({ Authorization: 'Bearer like-bearer', 'X-CSRF-TOKEN': 'like-csrf' }),
    }))
  })

  it('취소는 DELETE로 보내고 200 응답의 수와 상태를 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ likes: 3, liked: false }))
    await expect(new HttpWorkLikeRepository(fetcher).unlike('w1')).resolves.toEqual({ likes: 3, liked: false })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w1/like', expect.objectContaining({
      method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer like-bearer', 'X-CSRF-TOKEN': 'like-csrf' }),
    }))
  })

  it('작품 id는 경로에 안전하게 넣는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ likes: 1, liked: true }))
    await new HttpWorkLikeRepository(fetcher).like('a/b c')
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/works/a%2Fb%20c/like')
  })

  it('내 좋아요 상태는 공개 상세를 Bearer로 읽어 수와 liked만 꺼낸다(CSRF 없음)', async () => {
    const detail = { id: 'w1', title: '제목', likes: 12, liked: true, episodes: [], views: 0 }
    const fetcher = vi.fn().mockResolvedValue(Response.json(detail))
    await expect(new HttpWorkLikeRepository(fetcher).read('w1')).resolves.toEqual({ likes: 12, liked: true })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/v1/public/works/w1')
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer like-bearer' }))
    expect(init.headers).not.toHaveProperty('X-CSRF-TOKEN')
  })

  it('누르기·취소를 서버가 거절하면(비공개·없는 작품 404) detail을 그대로 알린다', async () => {
    const fetcher = vi.fn(async () => Response.json({ detail: '공개 작품을 찾을 수 없어요.' }, { status: 404 }))
    await expect(new HttpWorkLikeRepository(fetcher).like('w1')).rejects.toThrow('공개 작품을 찾을 수 없어요.')
    await expect(new HttpWorkLikeRepository(fetcher).unlike('w1')).rejects.toThrow('공개 작품을 찾을 수 없어요.')
  })

  it('상태 조회는 공개 작품이 아니면(404) null이고 그 밖의 실패는 던진다', async () => {
    const closed = vi.fn(async () => Response.json({ detail: '공개 작품을 찾을 수 없어요.' }, { status: 404 }))
    await expect(new HttpWorkLikeRepository(closed).read('w1')).resolves.toBeNull()
    const down = vi.fn(async () => Response.json({ detail: '잠시 후 다시 시도해 주세요.' }, { status: 503 }))
    await expect(new HttpWorkLikeRepository(down).read('w1')).rejects.toThrow('잠시 후 다시 시도해 주세요.')
    const bad = vi.fn(async () => Response.json({ likes: 'x' }))
    await expect(new HttpWorkLikeRepository(bad).read('w1')).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it('detail 없는 실패는 일반 안내로, 형식이 맞지 않는 성공 응답은 오류로 알린다', async () => {
    const down = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(new HttpWorkLikeRepository(down).like('w1')).rejects.toThrow('좋아요를 처리하지 못했어요')
    for (const body of [{ likes: 2 }, { liked: true }, { likes: -1, liked: true }, { likes: 1.5, liked: true }, { likes: 'x', liked: true }]) {
      const bad = vi.fn().mockResolvedValue(Response.json(body))
      await expect(new HttpWorkLikeRepository(bad).like('w1')).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    }
  })
})
