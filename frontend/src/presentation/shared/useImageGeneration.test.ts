// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useImageGeneration } from './useImageGeneration'

const useCase=vi.hoisted(()=>({read:vi.fn(),readByKey:vi.fn(),submit:vi.fn(),image:vi.fn()}))
vi.mock('../../app/appContainer',()=>({appContainer:{resolve:()=>useCase}}))
vi.mock('../../data/api/auth',()=>({authenticatedUserId:()=> 'owner'}))
const storageKey='image-generation:owner:work_cover:new'
beforeEach(()=>{sessionStorage.clear();sessionStorage.setItem(storageKey,'old-job')})
afterEach(()=>{cleanup();vi.resetAllMocks();sessionStorage.clear()})

it('삭제된 저장 작업이 생성 버튼을 영구 대기 상태로 묶지 않는다',async()=>{
 useCase.read.mockResolvedValue(null)
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}))
 await waitFor(()=>expect(result.current.job).toBeUndefined())
 expect(sessionStorage.getItem(storageKey)).toBeNull()
 expect(result.current.error).toContain('찾을 수 없어요')
 expect(useCase.submit).not.toHaveBeenCalled()
})

it('조회 통신 실패는 작업 기록을 지우거나 재생성하지 않는다',async()=>{
 useCase.read.mockRejectedValue(new Error('offline'))
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}))
 await waitFor(()=>expect(result.current.error).toContain('상태를 확인하지 못했어요'))
 expect(result.current.job?.jobId).toBe('old-job')
 expect(sessionStorage.getItem(storageKey)).toBe('old-job')
 expect(useCase.submit).not.toHaveBeenCalled()
})

it('같은 입력 재접수는 키를 유지하고 고정 설정이 바뀌면 새 키를 쓴다',async()=>{
 sessionStorage.clear()
 useCase.submit.mockRejectedValue(new Error('offline'))
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}))
 act(()=>{result.current.setPrompt('새벽 항구');result.current.setVisualSettings('황동 탑')})
 await act(async()=>{await result.current.generate()})
 await act(async()=>{await result.current.generate()})
 expect(useCase.submit.mock.calls[0][0]).toMatchObject({prompt:'새벽 항구',visualSettings:'황동 탑'})
 expect(useCase.submit.mock.calls[1][1]).toBe(useCase.submit.mock.calls[0][1])
 act(()=>result.current.setVisualSettings('흰 석조 탑'))
 await act(async()=>{await result.current.generate()})
 expect(useCase.submit.mock.calls[2][1]).not.toBe(useCase.submit.mock.calls[0][1])
 expect(result.current.prompt).toBe('새벽 항구')
})

it('다른 표지 대상으로 이동하면 이전 대상의 두 입력을 비운다',()=>{
 sessionStorage.clear()
 const {result,rerender}=renderHook(({workId})=>useImageGeneration({purpose:'work_cover',workId}),{initialProps:{workId:'first'}})
 act(()=>{result.current.setPrompt('장면');result.current.setVisualSettings('고정 설정')})
 rerender({workId:'second'})
 expect(result.current.prompt).toBe('')
 expect(result.current.visualSettings).toBe('')
})
