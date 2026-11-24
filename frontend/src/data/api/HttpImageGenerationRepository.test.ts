import { afterEach, expect, it, vi } from 'vitest'
import { ImageRequestRejected } from '../../domain/repositories/ImageGenerationRepository'
import { HttpImageGenerationRepository } from './HttpImageGenerationRepository'
import { protectedRequest } from './auth'

vi.mock('./auth', () => ({ protectedRequest: vi.fn() }))
vi.mock('./csrf', () => ({ csrf: async () => 'test-csrf' }))
afterEach(() => vi.resetAllMocks())

it('삭제되거나 접근할 수 없는 작업은 없음으로 반환한다', async () => {
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:404 }))
 expect(await new HttpImageGenerationRepository().read('missing')).toBeNull()
})

it('일시적인 서버 오류를 삭제된 작업으로 처리하지 않는다', async () => {
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:503 }))
 await expect(new HttpImageGenerationRepository().read('existing')).rejects.toThrow()
})

it('사용자 참조 파일을 생성 요청과 함께 한 번만 올린다', async () => {
 vi.mocked(protectedRequest).mockResolvedValue(new Response(JSON.stringify({
  jobId:'f4cba357-e367-4a9e-a8c4-dd4132ae1df1', status:'queued',stage:'waiting',previewUrl:null,
 })))
 const file=new File(['image'],'cover.png',{type:'image/png'})
 await new HttpImageGenerationRepository().submit({
  purpose:'work_cover',prompt:'scene',reference:{mode:'upload',role:'subject'},referenceFile:file,
 },'request-key')
 const [path,options]=vi.mocked(protectedRequest).mock.calls[0]
 expect(path).toBe('/api/v1/image-generations/with-reference')
 expect(options?.body).toBeInstanceOf(FormData)
 const form=options?.body as FormData
 expect(form.get('file')).toBe(file)
 expect(form.get('request')).toBeInstanceOf(Blob)
 expect(options?.headers).toMatchObject({'Idempotency-Key':'request-key','X-CSRF-TOKEN':'test-csrf'})
})

it.each([403, 409, 422])('접수가 %i로 거절되면 서버가 준 안내를 그대로 전달한다', async (status) => {
 vi.mocked(protectedRequest).mockResolvedValue(Response.json({ detail:'이 작품에서는 AI 생성을 사용할 수 없어요.' }, { status }))
 const error = await new HttpImageGenerationRepository().submit({ purpose:'work_cover', prompt:'scene' }, 'key').catch((e: unknown) => e)
 expect(error).toBeInstanceOf(ImageRequestRejected)
 expect((error as Error).message).toBe('이 작품에서는 AI 생성을 사용할 수 없어요.')
 expect(vi.mocked(protectedRequest).mock.calls[0][4]).toMatchObject({ allowHttpError:true })
})

it('서버 안내가 없는 4xx도 접수 거절로 알리고 5xx는 다시 시도할 수 있는 오류로 남긴다', async () => {
 const repository = new HttpImageGenerationRepository()
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:422 }))
 const rejected = await repository.submit({ purpose:'work_cover', prompt:'scene' }, 'key').catch((e: unknown) => e)
 expect(rejected).toBeInstanceOf(ImageRequestRejected)
 expect((rejected as Error).message).not.toBe('')
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:503 }))
 const unavailable = await repository.submit({ purpose:'work_cover', prompt:'scene' }, 'key').catch((e: unknown) => e)
 expect(unavailable).toBeInstanceOf(Error)
 expect(unavailable).not.toBeInstanceOf(ImageRequestRejected)
})

it('요청 키 조회도 작업 조회와 같은 규칙이다: 404는 없음, 그 밖의 오류는 오류', async () => {
 const repository = new HttpImageGenerationRepository()
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:404 }))
 expect(await repository.readByKey('missing')).toBeNull()
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:503 }))
 await expect(repository.readByKey('existing')).rejects.toThrow()
 vi.mocked(protectedRequest).mockResolvedValue(Response.json({ jobId:'f4cba357-e367-4a9e-a8c4-dd4132ae1df1', status:'queued', stage:'waiting', previewUrl:null }))
 expect(await repository.readByKey('a b')).toMatchObject({ status:'queued' })
 expect(vi.mocked(protectedRequest).mock.calls[2][0]).toBe('/api/v1/image-generations/by-request/a%20b')
})
