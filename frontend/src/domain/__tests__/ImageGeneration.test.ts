import { describe, it, expect, vi } from 'vitest'
import { ImageGenerationUseCase } from '../usecases/ImageGenerationUseCase'
describe('이미지 접수',()=>{
 it('빈 프롬프트는 유료 실행 경계에 보내지 않는다',()=>{
  const submit=vi.fn()
  const service=new ImageGenerationUseCase({submit,read:vi.fn(),readByKey:vi.fn(),image:vi.fn()})
  expect(()=>service.submit({purpose:'work_cover',prompt:'  '},'key')).toThrow()
  expect(submit).not.toHaveBeenCalled()
 })
 it('응답 유실 재접수에 같은 키와 입력을 전달한다',async()=>{
  const submit=vi.fn().mockResolvedValue({jobId:'job'})
  const service=new ImageGenerationUseCase({submit,read:vi.fn(),readByKey:vi.fn(),image:vi.fn()})
  const input={purpose:'work_cover' as const,prompt:'scene'}
  await service.submit(input,'same-key')
  await service.submit(input,'same-key')
  expect(submit.mock.calls).toEqual([[input,'same-key',undefined],[input,'same-key',undefined]])
 })
})
