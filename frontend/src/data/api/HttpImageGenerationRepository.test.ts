import { afterEach, expect, it, vi } from 'vitest'
import { HttpImageGenerationRepository } from './HttpImageGenerationRepository'
import { protectedRequest } from './auth'

vi.mock('./auth', () => ({ protectedRequest: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('삭제되거나 접근할 수 없는 작업은 없음으로 반환한다', async () => {
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:404 }))
 expect(await new HttpImageGenerationRepository().read('missing')).toBeNull()
})

it('일시적인 서버 오류를 삭제된 작업으로 처리하지 않는다', async () => {
 vi.mocked(protectedRequest).mockResolvedValue(new Response(null, { status:503 }))
 await expect(new HttpImageGenerationRepository().read('existing')).rejects.toThrow()
})
