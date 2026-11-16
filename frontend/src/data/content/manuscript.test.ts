import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { HttpManuscriptRepository } from './HttpManuscriptRepository'
import { ManuscriptUseCase } from '../../domain/usecases/ManuscriptUseCase'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const previewBody = {
  format: 'txt', unit: 'line', unitCount: 30, existingEpisodeCount: 2,
  episodes: [{ title: '1화 시작', from: 0, to: 10, charCount: 5120, excerpt: '앞 300자…', imageCount: 0, warnings: [] }, { title: '2화', from: 10, to: 30, charCount: 40001, excerpt: '[이미지] 둘째', imageCount: 2, warnings: ['본문이 40,000자를 넘어 등록할 수 없어요.'] }],
}
const items = [{ number: 1, title: '1화 시작', from: 0, to: 10 }, { number: 3, title: '2화', from: 10, to: 30 }]
const summaryBody = { succeeded: 2, failed: 1, results: [
  { number: 1, title: '1화 시작', status: 'versioned', reason: null, missingImages: 0 },
  { number: 2, title: '2화', status: 'partial', reason: '이미지 1개를 가져오지 못했어요.', missingImages: 1 },
  { number: 4, title: '4화', status: 'failed', reason: '앞 회차가 없어 등록할 수 없어요.', missingImages: 0 },
] }
const file = () => new File(['1화 시작\n본문'], '원고.txt', { type: 'text/plain' })

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'manuscript-csrf' }) : Response.json({ accessToken: 'manuscript-bearer', user: { id: 'owner', email: 'owner@example.invalid', nickname: 'Owner', operator: false } })))
  await login('owner@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

it('미리보기는 파일만 multipart로 보내고 JSON content-type 없이 csrf·bearer를 싣는다', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(previewBody))
  const controller = new AbortController()
  const result = await new HttpManuscriptRepository(fetcher).preview(workId, file(), controller.signal)
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe(`/api/v1/works/${workId}/manuscript-imports/preview`)
  expect(init.method).toBe('POST')
  expect(init.body).toBeInstanceOf(FormData)
  expect([...init.body.keys()]).toEqual(['file'])
  expect(init.body.get('file').name).toBe('원고.txt')
  expect(new Headers(init.headers).get('Content-Type')).toBeNull()
  expect(init.headers).toMatchObject({ Authorization: 'Bearer manuscript-bearer', 'X-CSRF-TOKEN': 'manuscript-csrf' })
  expect(init.credentials).toBe('same-origin')
  controller.abort()
  expect(init.signal.aborted).toBe(true)
  expect(result).toEqual(previewBody)
})

it('확정은 같은 파일과 application/json request 파트를 multipart로 보내고 회차별 결과를 그대로 돌려준다', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(summaryBody))
  const result = await new HttpManuscriptRepository(fetcher).confirm(workId, file(), true, items)
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe(`/api/v1/works/${workId}/manuscript-imports`)
  expect(init.method).toBe('POST')
  expect([...init.body.keys()]).toEqual(['file', 'request'])
  expect(init.body.get('file').name).toBe('원고.txt')
  const request = init.body.get('request')
  expect(request).toBeInstanceOf(Blob)
  expect(request.type).toBe('application/json')
  expect(JSON.parse(await request.text())).toEqual({ rightsConfirmed: true, items })
  expect(new Headers(init.headers).get('Content-Type')).toBeNull()
  expect(init.headers).toMatchObject({ Authorization: 'Bearer manuscript-bearer', 'X-CSRF-TOKEN': 'manuscript-csrf' })
  expect(result).toEqual(summaryBody)
})

it('일괄 업로드는 GET 기준 revision과 파일 순서에 맞는 multipart를 사용한다', async () => {
  const basis = { lastNumber: 2, workRevision: 7 }
  const result = {
    workRevision: 8, stopReason: null,
    results: [
      { number: 2, title: '둘째', status: 'versioned', versionId: 'saved-2', reason: null },
      { number: 3, title: '셋째', status: 'failed', versionId: null, reason: '본문이 비어 있어요.' },
    ],
  }
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(basis)).mockResolvedValueOnce(Response.json(result))
  const repo = new HttpManuscriptRepository(fetcher)
  expect(await repo.bulkBasis(workId)).toEqual(basis)
  expect(await repo.importBulkBatch(workId, [
    { file: file(), number: 2, title: '둘째' },
    { file: new File(['epub'], '셋째.epub'), number: 3, title: '셋째' },
  ], basis.workRevision)).toEqual(result)

  const [[getUrl, get], [postUrl, post]] = fetcher.mock.calls
  expect(getUrl).toBe(`/api/v1/works/${workId}/manuscript-imports/bulk`)
  expect(postUrl).toBe(getUrl)
  expect(get.method).toBe('GET')
  expect(get.headers).not.toHaveProperty('X-CSRF-TOKEN')
  expect(post.method).toBe('POST')
  expect(post.headers).toMatchObject({ Authorization: 'Bearer manuscript-bearer', 'X-CSRF-TOKEN': 'manuscript-csrf' })
  expect(post.body.getAll('files').map((part: File) => part.name)).toEqual(['episode.txt', 'episode.epub'])
  expect(await post.body.getAll('files')[0].text()).toBe('1화 시작\n본문')
  expect(JSON.parse(await post.body.get('request').text())).toEqual({
    rightsConfirmed: true, expectedWorkRevision: 7,
    items: [{ number: 2, title: '둘째' }, { number: 3, title: '셋째' }],
  })
})

it('서버의 detail을 그대로 보이고, detail이 없으면 상태별 안내를 쓴다', async () => {
  const fetcher = vi.fn()
  const repo = new HttpManuscriptRepository(fetcher)
  fetcher.mockResolvedValueOnce(Response.json({ detail: 'DRM이 걸린 EPUB은 읽을 수 없어요.' }, { status: 422 }))
  await expect(repo.preview(workId, file())).rejects.toThrow('DRM이 걸린 EPUB은 읽을 수 없어요.')
  fetcher.mockResolvedValueOnce(new Response('<html>413</html>', { status: 413 }))
  await expect(repo.preview(workId, file())).rejects.toThrow('TXT는 10MB, EPUB은 50MB')
  fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }))
  await expect(repo.confirm(workId, file(), true, items)).rejects.toThrow('작품을 찾을 수 없어요')
  fetcher.mockResolvedValueOnce(new Response('boom', { status: 500 }))
  await expect(repo.confirm(workId, file(), true, items)).rejects.toThrow('요청을 처리하지 못했어요')
})

it('형식이 다른 응답은 성공으로 보이지 않고 오류로 처리한다', async () => {
  const fetcher = vi.fn()
  const repo = new HttpManuscriptRepository(fetcher)
  fetcher.mockResolvedValueOnce(Response.json({ ...previewBody, format: 'pdf' }))
  await expect(repo.preview(workId, file())).rejects.toThrow('응답 형식')
  fetcher.mockResolvedValueOnce(Response.json({ succeeded: 1, failed: 0, results: [{ number: 1, title: 'x', status: 'ok', reason: null, missingImages: 0 }] }))
  await expect(repo.confirm(workId, file(), true, items)).rejects.toThrow('응답 형식')
})

it('계정이 바뀌는 동안 csrf를 기다리던 업로드는 보내지 않는다', async () => {
  let resolveCsrf!: (value: Response) => void
  const waiting = new Promise<Response>((resolve) => { resolveCsrf = resolve })
  const globalFetch = vi.mocked(fetch)
  globalFetch.mockImplementationOnce(() => waiting)
  const fetcher = vi.fn().mockResolvedValue(Response.json(previewBody))
  const pending = new HttpManuscriptRepository(fetcher).preview(workId, file())
  await vi.waitFor(() => expect(globalFetch).toHaveBeenLastCalledWith('/api/v1/auth/csrf', expect.anything()))
  const rejection = expect(pending).rejects.toThrow('cancelled')
  const signingIn = login('other@example.invalid', 'test-password')
  resolveCsrf(Response.json({ csrfToken: 'old-csrf' }))
  await signingIn
  await rejection
  expect(fetcher).not.toHaveBeenCalled()
})

it('내보내기는 쿼리로 요청하고 Content-Disposition filename*의 파일명과 바이트를 돌려준다', async () => {
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent('내 작품_1화.epub')}`
  const fetcher = vi.fn().mockResolvedValue(new Response('epub-bytes', { headers: { 'Content-Type': 'application/epub+zip', 'Content-Disposition': disposition } }))
  const repo = new HttpManuscriptRepository(fetcher)
  const result = await repo.exportManuscript(workId, { format: 'epub', source: 'published', episode: 2 })
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe(`/api/v1/works/${workId}/manuscript-export?format=epub&source=published&episode=2`)
  expect(init.method).toBe('GET')
  expect(init.headers).toMatchObject({ Authorization: 'Bearer manuscript-bearer' })
  expect(init.headers).not.toHaveProperty('X-CSRF-TOKEN')
  expect(result.filename).toBe('내 작품_1화.epub')
  expect(await result.blob.text()).toBe('epub-bytes')
  fetcher.mockResolvedValueOnce(new Response('txt', { headers: { 'Content-Disposition': disposition } }))
  await repo.exportManuscript(workId, { format: 'txt', source: 'draft' })
  expect(fetcher.mock.calls[1][0]).toBe(`/api/v1/works/${workId}/manuscript-export?format=txt&source=draft`)
})

it('내보내기 파일명이 없거나 위험하면 안전한 이름으로 바꾸고, 오류와 빈 응답은 성공으로 보이지 않는다', async () => {
  const fetcher = vi.fn()
  const repo = new HttpManuscriptRepository(fetcher)
  fetcher.mockResolvedValueOnce(new Response('txt'))
  expect((await repo.exportManuscript(workId, { format: 'txt', source: 'draft' })).filename).toBe('원고.txt')
  fetcher.mockResolvedValueOnce(new Response('txt', { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''..%2F..%5Cevil%3A.txt" } }))
  expect((await repo.exportManuscript(workId, { format: 'txt', source: 'draft' })).filename).toBe('.._.._evil_.txt')
  fetcher.mockResolvedValueOnce(new Response('txt', { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''%E0%A4%A.txt" } }))
  expect((await repo.exportManuscript(workId, { format: 'epub', source: 'draft' })).filename).toBe('원고.epub')
  fetcher.mockResolvedValueOnce(Response.json({ detail: '내보낼 수 있는 회차가 없어요.' }, { status: 422 }))
  await expect(repo.exportManuscript(workId, { format: 'txt', source: 'published' })).rejects.toThrow('내보낼 수 있는 회차가 없어요.')
  fetcher.mockResolvedValueOnce(new Response(''))
  await expect(repo.exportManuscript(workId, { format: 'txt', source: 'draft' })).rejects.toThrow('파일 응답')
})

it('UseCase를 거치면 데모 작품 ID는 서버로 보내지 않는다', async () => {
  const fetcher = vi.fn()
  await expect(new ManuscriptUseCase(new HttpManuscriptRepository(fetcher)).exportManuscript('demo', { format: 'txt', source: 'draft' })).rejects.toThrow('작품')
  expect(fetcher).not.toHaveBeenCalled()
})
