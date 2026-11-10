// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWritingViewModel } from './useWritingViewModel'

afterEach(()=>{cleanup();vi.useRealTimers()})
it('권한 철회 후 취소를 무시한 늦은 저장 응답도 원고를 되살리지 않는다',async()=>{
 const episode={number:1,draft:{title:'비공개',body:'비공개 원고',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
 let release:(value:typeof episode)=>void=()=>{}
 const api={writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn(()=>new Promise<typeof episode>(resolve=>{release=resolve})),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
 const {result}=renderHook(()=>useWritingViewModel('w',api));await act(async()=>{})
 let save:Promise<unknown>=Promise.resolve()
 act(()=>{save=result.current.save()})
 act(()=>result.current.clearPrivate())
 await act(async()=>{release(episode);await save})
 expect(result.current.draft.body).toBe('');expect(result.current.active).toBeNull()
})
it('inserts an uploaded immutable image reference at the cursor and keeps it through a saved version',async()=>{
 const id='b142427a-cd9d-4fdc-a40d-c9e553d87d30';const imageId='e25ffb25-8128-48c0-8d66-e1d56831cd56'
 const episode={number:1,draft:{title:'1화',body:'앞뒤',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
 const body=`앞\n\n[[image:${imageId}]]\n\n뒤`
 const api={writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockResolvedValue({...episode,draft:{...episode.draft,body,revision:1}}),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
 const media={upload:vi.fn().mockResolvedValue({id:imageId})}
 const {result}=renderHook(()=>useWritingViewModel(id,api,media))
 await act(async()=>{})
 await act(async()=>{await result.current.addImage(new File(['png'],'본문.png'),1,1)})
 expect(result.current.draft.body).toBe(body)
 await act(async()=>{await result.current.save()})
 expect(api.writeEpisode).toHaveBeenLastCalledWith(id,1,{...episode.draft,body},true,expect.any(AbortSignal))
 media.upload.mockRejectedValue(new Error('저장소 실패'))
 await act(async()=>{await result.current.addImage(new File(['png'],'실패.png'),0,0)})
 expect(result.current.draft.body).toBe(body);expect(result.current.error).toBe('저장소 실패')
})

it('accepts server-normalized titles without an endless autosave loop',async()=>{
  vi.useFakeTimers()
  const episode={number:1,draft:{title:'제목',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
  const api={writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockResolvedValue({...episode,draft:{...episode.draft,revision:1}}),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({title:' 제목 '}))
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
  expect(result.current.draft.title).toBe('제목')
  expect(result.current.dirty).toBe(false)
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
  expect(api.writeEpisode).toHaveBeenCalledTimes(1)
})
it('autosaves only the draft after two seconds and retains edits on conflict',async()=>{
  vi.useFakeTimers()
  const episode={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
  const api={writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockRejectedValue(new Error('동시 수정 충돌')),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({body:'내 수정'}))
  await act(async()=>{await vi.advanceTimersByTimeAsync(1999)})
  expect(api.writeEpisode).not.toHaveBeenCalled()
  await act(async()=>{await vi.advanceTimersByTimeAsync(1)})
  expect(api.writeEpisode).toHaveBeenCalledWith('w',1,{title:'1화',body:'내 수정',revision:0},false,expect.any(AbortSignal))
  expect(result.current.draft.body).toBe('내 수정')
  expect(result.current.error).toBe('동시 수정 충돌')
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
  expect(api.writeEpisode).toHaveBeenCalledTimes(1)
})

it('late autosave response preserves newer typing and manual save creates a version',async()=>{
  vi.useFakeTimers()
  const episode={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
  let resolveSave: (value:typeof episode)=>void=()=>{}
  const api={writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveSave=resolve})).mockResolvedValue({...episode,draft:{title:'1화',body:'최신 입력',revision:2}}),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({body:'첫 입력'}))
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
  expect(result.current.editingLocked).toBe(false)
  expect(result.current.busy).toBe(true)
  act(()=>result.current.edit({body:'최신 입력'}))
  await act(async()=>resolveSave({...episode,draft:{title:'1화',body:'첫 입력',revision:1}}))
  expect(result.current.draft.body).toBe('최신 입력')
  await act(async()=>{await result.current.save()})
  expect(api.writeEpisode).toHaveBeenLastCalledWith('w',1,{title:'1화',body:'최신 입력',revision:1},true,expect.any(AbortSignal))
})

it('returns false when episode navigation is cancelled and keeps the dirty draft',async()=>{
  const first={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
  const second={...first,number:2,draft:{...first.draft,title:'2화'}}
  const api={writingList:vi.fn().mockResolvedValue([first,second]),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({body:'미저장'}))
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  try {
    act(()=>expect(result.current.select(second)).toBe(false))
    expect(result.current.active?.number).toBe(1)
    expect(result.current.draft.body).toBe('미저장')
    confirm.mockReturnValue(true)
    act(()=>expect(result.current.select(second)).toBe(true))
    expect(result.current.active?.number).toBe(2)
  } finally {confirm.mockRestore()}
})


it('clears deleted input even when refreshing the list fails',async()=>{
  const episode={number:1,draft:{title:'1화',body:'기존',revision:4},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
  const api={writingList:vi.fn().mockResolvedValueOnce([episode]).mockRejectedValueOnce(new Error('목록 조회 실패')),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn().mockResolvedValue(undefined),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({body:'버릴 입력'}))
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
  try {
    await act(async()=>{await result.current.deleteDraft()})
    expect(api.deleteDraft).toHaveBeenCalledWith('w',1,4,expect.any(AbortSignal))
    expect(result.current.active).toBeNull()
    expect(result.current.draft.body).toBe('')
    expect(api.writeEpisode).not.toHaveBeenCalled()
  } finally {confirm.mockRestore()}
})

it('reports whether leaving the studio would lose work: clean may leave, dirty asks first, in-flight requests block',async()=>{
  const episode={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only'}
  let release:()=>void=()=>{}
  const api={writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockImplementation(()=>new Promise(resolve=>{release=()=>resolve(episode)})),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  try {
    const {result}=renderHook(()=>useWritingViewModel('w',api))
    await act(async()=>{})
    expect(result.current.mayLeave()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    act(()=>result.current.edit({body:'저장 전'}))
    expect(result.current.mayLeave()).toBe(false)
    expect(confirm).toHaveBeenCalledWith('저장하지 않은 입력을 버리고 이동할까요?')
    confirm.mockClear().mockReturnValue(true)
    expect(result.current.mayLeave()).toBe(true)
    let saving:Promise<unknown>=Promise.resolve()
    act(()=>{saving=result.current.save()})
    confirm.mockClear()
    expect(result.current.mayLeave()).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    await act(async()=>{release();await saving})
  } finally {
    confirm.mockRestore()
  }
})
