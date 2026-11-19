import { afterEach, expect, it, vi } from 'vitest'
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
