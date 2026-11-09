import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { HttpReadingRecordRepository } from './HttpReadingRecordRepository'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'reader', email: 'reader@example.invalid', nickname: 'Reader', operator: false } })))
  await login('reader@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

/** Content 독서 기록 한 건 (GET /api/v1/works/reading의 records 원소) */
const row = (over: object = {}) => ({ workId: 'w1', lastEpisode: 2, readEpisodes: [1, 2], updatedAt: '2026-11-09T01:00:00Z', ...over })
const sent = (fetcher: ReturnType<typeof vi.fn>) => { const [url, init] = fetcher.mock.calls[0]; return { url, init, headers: new Headers(init.headers) } }

describe('독서 기록 Http 저장소 (/api/v1/works/reading)', () => {
  it('목록은 본인 Bearer로 GET하고 기록을 도메인 형태로 바꾼다 (CSRF 없음)', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ records: [row(), row({ workId: 'w2', lastEpisode: 1, readEpisodes: [1] })] }))
    const records = await new HttpReadingRecordRepository(fetcher).list()
    const { url, init, headers } = sent(fetcher)
    expect(url).toBe('/api/v1/works/reading')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(headers.get('Authorization')).toBe('Bearer content-bearer')
    expect(headers.has('X-CSRF-TOKEN')).toBe(false)
    expect(records).toEqual([{ workId: 'w1', lastEpisode: 2, readEpisodes: [1, 2] }, { workId: 'w2', lastEpisode: 1, readEpisodes: [1] }])
  })

  it('기록이 없으면 빈 목록이다', async () => {
    expect(await new HttpReadingRecordRepository(vi.fn().mockResolvedValue(Response.json({ records: [] }))).list()).toEqual([])
  })

  it('열람 기록은 PUT으로 회차 번호까지 보내고 CSRF를 붙이며 204에서 끝난다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(new HttpReadingRecordRepository(fetcher).record('w1', 3)).resolves.toBeUndefined()
    const { url, init, headers } = sent(fetcher)
    expect(url).toBe('/api/v1/works/w1/reading/3')
    expect(init.method).toBe('PUT')
    expect(headers.get('X-CSRF-TOKEN')).toBe('content-csrf')
    expect(headers.get('Authorization')).toBe('Bearer content-bearer')
  })

  it('삭제는 DELETE로 그 작품의 기록만 지우고 204에서 끝난다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(new HttpReadingRecordRepository(fetcher).remove('w1')).resolves.toBeUndefined()
    const { url, init, headers } = sent(fetcher)
    expect(url).toBe('/api/v1/works/w1/reading')
    expect(init.method).toBe('DELETE')
    expect(headers.get('X-CSRF-TOKEN')).toBe('content-csrf')
  })

  it('작품 id는 경로에 안전하게 인코딩한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    await new HttpReadingRecordRepository(fetcher).record('a/b c', 1)
    expect(sent(fetcher).url).toBe('/api/v1/works/a%2Fb%20c/reading/1')
  })

  it('서버가 거절하면 서버 문구를 그대로 알리고 성공으로 보지 않는다', async () => {
    const reject = (status: number) => vi.fn().mockImplementation(async () => Response.json({ detail: '공개 회차를 찾을 수 없어요.' }, { status }))
    await expect(new HttpReadingRecordRepository(reject(404)).record('w1', 9)).rejects.toThrow('공개 회차를 찾을 수 없어요.')
    await expect(new HttpReadingRecordRepository(reject(404)).remove('w1')).rejects.toThrow('공개 회차를 찾을 수 없어요.')
    await expect(new HttpReadingRecordRepository(reject(500)).list()).rejects.toThrow('공개 회차를 찾을 수 없어요.')
    await expect(new HttpReadingRecordRepository(vi.fn().mockResolvedValue(new Response('boom', { status: 502 }))).list())
      .rejects.toThrow('요청을 처리하지 못했어요')
  })

  it('204가 아닌 성공 응답과 계약에 없는 목록 응답은 성공으로 받지 않는다', async () => {
    await expect(new HttpReadingRecordRepository(vi.fn().mockResolvedValue(Response.json({ ok: true }))).record('w1', 1)).rejects.toThrow('저장 완료 응답을 확인할 수 없어요')
    await expect(new HttpReadingRecordRepository(vi.fn().mockResolvedValue(Response.json({ ok: true }))).remove('w1')).rejects.toThrow('삭제 완료 응답을 확인할 수 없어요')
    for (const body of [{ records: [{ workId: 'w1', lastEpisode: 0, readEpisodes: [], updatedAt: 'x' }] }, { records: [row({ readEpisodes: ['1'] })] }, { records: 'none' }, []]) {
      await expect(new HttpReadingRecordRepository(vi.fn().mockResolvedValue(Response.json(body))).list()).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
    }
  })
})
