// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAppStore, type AppStore } from '../../app/store'
import { sessionActions } from './session/sessionSlice'
import { useImageGeneration } from './useImageGeneration'

const useCase=vi.hoisted(()=>({read:vi.fn(),readByKey:vi.fn(),submit:vi.fn(),image:vi.fn()}))
vi.mock('../../app/appContainer',()=>({appContainer:{resolve:()=>useCase}}))
const storageKey='image-generation:owner:work_cover:new'
let store: AppStore
const wrapper = ({children}: PropsWithChildren) => createElement(Provider, {store, children})
beforeEach(()=>{store=createAppStore({memberId:'owner'});sessionStorage.clear();sessionStorage.setItem(storageKey,'old-job')})
afterEach(()=>{cleanup();vi.resetAllMocks();sessionStorage.clear()})

it('삭제된 저장 작업이 생성 버튼을 영구 대기 상태로 묶지 않는다',async()=>{
 useCase.read.mockResolvedValue(null)
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 await waitFor(()=>expect(result.current.job).toBeUndefined())
 expect(sessionStorage.getItem(storageKey)).toBeNull()
 expect(result.current.error).toContain('찾을 수 없어요')
 expect(useCase.submit).not.toHaveBeenCalled()
})

it('조회 통신 실패는 작업 기록을 지우거나 재생성하지 않는다',async()=>{
 useCase.read.mockRejectedValue(new Error('offline'))
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 await waitFor(()=>expect(result.current.error).toContain('상태를 확인하지 못했어요'))
 expect(result.current.job?.jobId).toBe('old-job')
 expect(sessionStorage.getItem(storageKey)).toBe('old-job')
 expect(useCase.submit).not.toHaveBeenCalled()
})

it('새 생성 요청의 접수를 확인하지 못해도 이전 미리보기를 다시 표시하지 않는다',async()=>{
 const create=URL.createObjectURL
 const revoke=URL.revokeObjectURL
 URL.createObjectURL=vi.fn(()=> 'blob:old')
 URL.revokeObjectURL=vi.fn()
 try {
  useCase.read.mockResolvedValue({jobId:'old-job',status:'succeeded',stage:'completed',previewUrl:'/content'})
  useCase.image.mockResolvedValue(new Blob(['old']))
  useCase.submit.mockRejectedValue(new Error('offline'))
  const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
  await waitFor(()=>expect(result.current.preview).toBe('blob:old'))
  act(()=>result.current.setPrompt('새벽 항구'))
  await act(async()=>{await result.current.generate()})
  expect(result.current.error).toContain('접수하지 못했어요')
  expect(result.current.preview).toBe('')
  expect(useCase.image).toHaveBeenCalledOnce()
 } finally {
  cleanup()
  URL.createObjectURL=create
  URL.revokeObjectURL=revoke
 }
})

it.each([
 ['output_blocked','콘텐츠 기준'],
 ['moderation_unavailable','안전성을 확인하지 못했어요'],
])('저장 전 검사 실패 %s에 안내를 표시하고 미리보기를 읽지 않는다',async(stage,message)=>{
 useCase.read.mockResolvedValue({jobId:'old-job',status:'failed',stage,previewUrl:null})
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 await waitFor(()=>expect(result.current.error).toContain(message))
 expect(useCase.image).not.toHaveBeenCalled()
 expect(useCase.submit).not.toHaveBeenCalled()
})

it('같은 입력 재접수는 키를 유지하고 고정 설정이 바뀌면 새 키를 쓴다',async()=>{
 sessionStorage.clear()
 useCase.submit.mockRejectedValue(new Error('offline'))
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 act(()=>{result.current.setPrompt('새벽 항구');result.current.setVisualSettings('황동 탑')})
 await act(async()=>{await result.current.generate()})
 await act(async()=>{await result.current.generate()})
 expect(useCase.submit.mock.calls[0][0]).toMatchObject({
  prompt:'새벽 항구',visualSettings:'황동 탑',reference:{mode:'preset',role:'style',presetVersion:'landscape-v1'},
 })
 expect(useCase.submit.mock.calls[1][1]).toBe(useCase.submit.mock.calls[0][1])
 act(()=>result.current.setVisualSettings('흰 석조 탑'))
 await act(async()=>{await result.current.generate()})
 expect(useCase.submit.mock.calls[2][1]).not.toBe(useCase.submit.mock.calls[0][1])
 expect(result.current.prompt).toBe('새벽 항구')
})

it('현재 표지로 바꾸면 기본 이미지를 대체하고 새 요청 키를 쓴다',async()=>{
 sessionStorage.clear()
 useCase.submit.mockRejectedValue(new Error('offline'))
 const {result}=renderHook(()=>useImageGeneration({purpose:'world_cover',worldId:'world'}),{wrapper})
 act(()=>result.current.setPrompt('장면'))
 await act(async()=>{await result.current.generate()})
 act(()=>{result.current.setReferenceMode('cover');result.current.setReferenceRole('subject')})
 await act(async()=>{await result.current.generate()})
 expect(useCase.submit.mock.calls[1][0]).toMatchObject({worldId:'world',reference:{mode:'cover',role:'subject'}})
 expect(useCase.submit.mock.calls[1][1]).not.toBe(useCase.submit.mock.calls[0][1])
})

it('다른 표지 대상으로 이동하면 이전 대상의 두 입력을 비운다',()=>{
 sessionStorage.clear()
 const {result,rerender}=renderHook(({workId})=>useImageGeneration({purpose:'work_cover',workId}),{wrapper,initialProps:{workId:'first'}})
 act(()=>{result.current.setPrompt('장면');result.current.setVisualSettings('고정 설정')})
 rerender({workId:'second'})
 expect(result.current.prompt).toBe('')
 expect(result.current.visualSettings).toBe('')
})

it('회원이 바뀌면 새 회원의 화면 작업만 복원한다',async()=>{
 useCase.read.mockImplementation(async (jobId: string)=>({jobId,status:'interrupted',stage:'dispatching',previewUrl:null}))
 sessionStorage.setItem('image-generation:another:work_cover:new','another-job')
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 await waitFor(()=>expect(result.current.job?.jobId).toBe('old-job'))
 act(()=>store.dispatch(sessionActions.login({id:'another',nickname:'작가',email:'another@example.test',operator:false})))
 await waitFor(()=>expect(result.current.job?.jobId).toBe('another-job'))
 expect(sessionStorage.getItem(storageKey)).toBe('old-job')
 expect(useCase.read.mock.calls.map(([id])=>id)).toEqual(['old-job','another-job'])
})
