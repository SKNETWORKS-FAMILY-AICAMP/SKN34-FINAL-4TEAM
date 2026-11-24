// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAppStore, type AppStore } from '../../app/store'
import { ImageRequestRejected } from '../../domain/repositories/ImageGenerationRepository'
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
  sessionStorage.clear()
  useCase.submit.mockResolvedValueOnce({jobId:'old-job',status:'queued',stage:'waiting',previewUrl:null})
  useCase.submit.mockRejectedValue(new Error('offline'))
  useCase.read.mockResolvedValue({jobId:'old-job',status:'succeeded',stage:'completed',previewUrl:'/content'})
  useCase.image.mockResolvedValue(new Blob(['old']))
  const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
  act(()=>result.current.setPrompt('새벽 항구'))
  await act(async()=>{await result.current.generate()})
  await waitFor(()=>expect(result.current.preview).toBe('blob:old'))
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
 ['failed','output_blocked','콘텐츠 기준'],
 ['failed','moderation_unavailable','안전성을 확인하지 못했어요'],
 ['failed','generating','이미지를 만들지 못했어요. 다시 생성해 주세요.'],
 ['interrupted','generating','이미지를 만들지 못했어요. 다시 생성해 주세요.'],
])('작업이 %s/%s로 끝나면 안내를 표시하고 미리보기를 읽지 않으며 저장 기록을 지운다',async(status,stage,message)=>{
 sessionStorage.clear()
 useCase.submit.mockResolvedValue({jobId:'new-job',status:'queued',stage:'waiting',previewUrl:null})
 useCase.read.mockResolvedValue({jobId:'new-job',status,stage,previewUrl:null})
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 act(()=>result.current.setPrompt('새벽 항구'))
 await act(async()=>{await result.current.generate()})
 await waitFor(()=>expect(result.current.error).toContain(message))
 expect(useCase.image).not.toHaveBeenCalled()
 expect(sessionStorage.getItem(storageKey)).toBeNull()
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
 useCase.read.mockImplementation(async (jobId: string)=>({jobId,status:'running',stage:'generating',previewUrl:null}))
 sessionStorage.setItem('image-generation:another:work_cover:new','another-job')
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 await waitFor(()=>expect(result.current.job?.jobId).toBe('old-job'))
 act(()=>store.dispatch(sessionActions.login({id:'another',nickname:'작가',email:'another@example.test',operator:false})))
 await waitFor(()=>expect(result.current.job?.jobId).toBe('another-job'))
 expect(sessionStorage.getItem(storageKey)).toBe('old-job')
 expect(useCase.read.mock.calls.map(([id])=>id)).toEqual(['old-job','another-job'])
})

it.each(['succeeded','failed','interrupted'])('화면을 다시 열면 끝난 지난 작업(%s)은 결과도 실패도 다시 보이지 않고 저장 기록을 지운다',async(status)=>{
 useCase.read.mockResolvedValue({jobId:'old-job',status,stage:'completed',previewUrl:'/content'})
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 await waitFor(()=>expect(sessionStorage.getItem(storageKey)).toBeNull())
 expect(result.current.job).toBeUndefined()
 expect(result.current.error).toBe('')
 expect(result.current.preview).toBe('')
 expect(useCase.image).not.toHaveBeenCalled()
})

it('화면을 다시 열었을 때 아직 진행 중인 작업은 이어서 보여 준다',async()=>{
 useCase.read.mockResolvedValue({jobId:'old-job',status:'running',stage:'generating',previewUrl:null})
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 // 복원 직후의 job은 queued 자리표시자라, 첫 조회 응답이 반영될 때까지 상태로 기다린다.
 await waitFor(()=>expect(result.current.job).toMatchObject({jobId:'old-job',status:'running'}))
 expect(useCase.read).toHaveBeenCalledOnce()
 expect(sessionStorage.getItem(storageKey)).toBe('old-job')
})

it('상태 확인에 실패한 뒤 다시 확인하면 그 사이 끝난 작업의 결과를 보여 준다',async()=>{
 const create=URL.createObjectURL
 const revoke=URL.revokeObjectURL
 URL.createObjectURL=vi.fn(()=> 'blob:done')
 URL.revokeObjectURL=vi.fn()
 try {
  useCase.read.mockRejectedValueOnce(new Error('offline'))
  useCase.read.mockResolvedValue({jobId:'old-job',status:'succeeded',stage:'completed',previewUrl:'/content'})
  useCase.image.mockResolvedValue(new Blob(['done']))
  const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
  await waitFor(()=>expect(result.current.error).toContain('상태를 확인하지 못했어요'))
  expect(result.current.error).toContain('상태 다시 확인')
  act(()=>result.current.retry())
  await waitFor(()=>expect(result.current.preview).toBe('blob:done'))
 } finally {
  cleanup()
  URL.createObjectURL=create
  URL.revokeObjectURL=revoke
 }
})

it('선택을 마친 작업은 clear로 저장 기록을 지운다',async()=>{
 useCase.read.mockResolvedValue({jobId:'old-job',status:'running',stage:'generating',previewUrl:null})
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 await waitFor(()=>expect(useCase.read).toHaveBeenCalledOnce())
 act(()=>result.current.clear())
 expect(sessionStorage.getItem(storageKey)).toBeNull()
})

it('접수가 4xx로 거절되면 서버 안내를 그대로 보이고 다음 요청은 새 키를 쓴다',async()=>{
 sessionStorage.clear()
 useCase.submit.mockRejectedValueOnce(new ImageRequestRejected('이 작품에서는 AI 생성을 사용할 수 없어요.'))
 useCase.submit.mockRejectedValue(new Error('offline'))
 const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
 act(()=>result.current.setPrompt('새벽 항구'))
 await act(async()=>{await result.current.generate()})
 expect(result.current.error).toBe('이 작품에서는 AI 생성을 사용할 수 없어요.')
 expect(sessionStorage.getItem(storageKey+':request')).toBeNull()
 await act(async()=>{await result.current.generate()})
 expect(useCase.submit.mock.calls[1][1]).not.toBe(useCase.submit.mock.calls[0][1])
 expect(result.current.error).toBe('접수하지 못했어요. 다시 누르면 이전 요청 결과를 이어서 확인해요.')
})

it('성공한 결과를 내려받는 동안 loadingPreview가 켜지고 끝나면 미리보기가 나온다',async()=>{
 const create=URL.createObjectURL
 const revoke=URL.revokeObjectURL
 URL.createObjectURL=vi.fn(()=> 'blob:loaded')
 URL.revokeObjectURL=vi.fn()
 try {
  sessionStorage.clear()
  let finish!:(blob:Blob)=>void
  useCase.submit.mockResolvedValue({jobId:'new-job',status:'queued',stage:'waiting',previewUrl:null})
  useCase.read.mockResolvedValue({jobId:'new-job',status:'succeeded',stage:'completed',previewUrl:'/content'})
  useCase.image.mockReturnValue(new Promise<Blob>(resolve=>{finish=resolve}))
  const {result}=renderHook(()=>useImageGeneration({purpose:'work_cover'}),{wrapper})
  act(()=>result.current.setPrompt('장면'))
  await act(async()=>{await result.current.generate()})
  await waitFor(()=>expect(result.current.loadingPreview).toBe(true))
  expect(result.current.preview).toBe('')
  await act(async()=>finish(new Blob(['image'])))
  await waitFor(()=>expect(result.current.preview).toBe('blob:loaded'))
  expect(result.current.loadingPreview).toBe(false)
 } finally {
  cleanup()
  URL.createObjectURL=create
  URL.revokeObjectURL=revoke
 }
})
