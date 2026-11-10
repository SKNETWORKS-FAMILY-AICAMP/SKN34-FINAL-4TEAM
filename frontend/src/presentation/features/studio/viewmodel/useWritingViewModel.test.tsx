// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWritingViewModel } from './useWritingViewModel'

afterEach(()=>{cleanup();vi.useRealTimers()})
it('inserts an uploaded immutable image reference at the cursor and keeps it through a saved version',async()=>{
 const id='b142427a-cd9d-4fdc-a40d-c9e553d87d30';const imageId='e25ffb25-8128-48c0-8d66-e1d56831cd56'
 const episode={number:1,draft:{title:'1화',body:'앞뒤',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
 const body=`앞\n\n[[image:${imageId}]]\n\n뒤`
 const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockResolvedValue({...episode,draft:{...episode.draft,body,revision:1}}),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
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
  const episode={number:1,draft:{title:'제목',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockResolvedValue({...episode,draft:{...episode.draft,revision:1}}),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
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
  const episode={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockRejectedValue(new Error('동시 수정 충돌')),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
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
  const episode={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  let resolveSave: (value:typeof episode)=>void=()=>{}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveSave=resolve})).mockResolvedValue({...episode,draft:{title:'1화',body:'최신 입력',revision:2}}),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
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
  const first={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const second={...first,number:2,draft:{...first.draft,title:'2화'}}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([first,second]),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
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


it.each([
  ['deleteDraft','작업 초안을 삭제했어요.'],
  ['deleteEpisode','회차를 삭제했어요.'],
] as const)('%s warns about unsaved input and clears it even when refreshing fails',async(action,notice)=>{
  const episode={number:1,draft:{title:'1화',body:'기존',revision:4},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValueOnce([episode]).mockRejectedValueOnce(new Error('목록 조회 실패')),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn().mockResolvedValue(undefined),deleteEpisode:vi.fn().mockResolvedValue(undefined)}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({body:'버릴 입력'}))
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
  try {
    await act(async()=>{await result.current[action]()})
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('저장하지 않은 입력은 사라져요.'))
    expect(api[action]).toHaveBeenCalledWith('w',1,4,expect.any(AbortSignal))
    expect(result.current.active).toBeNull()
    expect(result.current.draft.body).toBe('')
    expect(result.current.notice).toContain(notice)
    expect(result.current.error).toBe('목록 조회 실패')
    expect(api.writeEpisode).not.toHaveBeenCalled()
  } finally {confirm.mockRestore()}
})

const row=(number:number,patch:Record<string,unknown>={})=>({number,draft:{title:`${number}화`,body:'기존',revision:4},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[],...patch})
const deletionApi=(rows:ReturnType<typeof row>[])=>({setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue(rows),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn().mockResolvedValue(undefined),deleteEpisode:vi.fn().mockResolvedValue(undefined)})

it.each([
  ['the last episode without versions has nothing to explain',[row(1)],''],
  ['a published episode',[row(1,{publishedVersionId:'v1'})],'발행본이 있는 회차는 삭제할 수 없어요.'],
  ['an episode with a saved version',[row(1,{versions:[{id:'v1'}]})],'저장한 버전이 있는 회차는 삭제할 수 없어요.'],
  ['a published episode with saved versions',[row(1,{publishedVersionId:'v1',versions:[{id:'v1'}]})],'발행본·저장한 버전이 있는 회차는 삭제할 수 없어요.'],
  ['an episode followed by another one',[row(1),row(2)],'마지막 회차(2화)만 삭제할 수 있어요.'],
  ['every unmet condition together',[row(1,{versions:[{id:'v1'}]}),row(3)],'저장한 버전이 있는 회차는 삭제할 수 없어요. 마지막 회차(3화)만 삭제할 수 있어요.'],
  ['an inherited episode',[row(1,{inherited:true,publishedVersionId:'v1'})],'원작 기준 회차는 삭제할 수 없어요.'],
])('deleteBlocker for %s uses only values the screen already has',async(_name,rows,expected)=>{
  const api=deletionApi(rows)
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  expect(result.current.deleteBlocker).toBe(expected)
})

it('deleteBlocker follows the selected episode and is empty before one is loaded',async()=>{
  const api=deletionApi([row(1),row(2)])
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  expect(result.current.deleteBlocker).toBe('')
  await act(async()=>{})
  expect(result.current.deleteBlocker).toBe('마지막 회차(2화)만 삭제할 수 있어요.')
  act(()=>{result.current.select(result.current.episodes[1])})
  expect(result.current.deleteBlocker).toBe('')
})

it('confirms an episode deletion as irreversible and says the number can be reused',async()=>{
  const api=deletionApi([row(1)])
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
  try {
    await act(async()=>{expect(await result.current.deleteEpisode()).toBe(false)})
    const message=String(confirm.mock.calls[0][0])
    expect(message).toContain('삭제하면 되돌릴 수 없어요.')
    expect(message).toContain('같은 번호로 새 회차를 만들 수 있어요.')
    expect(message).toContain('저장하지 않은 입력은 사라져요.')
    expect(message).not.toContain('숨겨져요')
    expect(api.deleteEpisode).not.toHaveBeenCalled()
  } finally {confirm.mockRestore()}
})

it.each(['deleteDraft','deleteEpisode'] as const)('%s resolves true once the deletion is committed even if refreshing the list fails',async action=>{
  const api=deletionApi([row(1)])
  api.writingList.mockResolvedValueOnce([row(1)]).mockRejectedValueOnce(new Error('목록 조회 실패'))
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
  try {
    await act(async()=>{expect(await result.current[action]()).toBe(true)})
    expect(result.current.error).toBe('목록 조회 실패')
    expect(result.current.active).toBeNull()
  } finally {confirm.mockRestore()}
})

it.each(['deleteDraft','deleteEpisode'] as const)('%s resolves false and keeps the episode when the server rejects it',async action=>{
  const api=deletionApi([row(1)])
  api[action].mockRejectedValue(new Error('삭제할 수 없어요.'))
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
  try {
    await act(async()=>{expect(await result.current[action]()).toBe(false)})
    expect(result.current.error).toBe('삭제할 수 없어요.')
    expect(result.current.active?.number).toBe(1)
    expect(api.writingList).toHaveBeenCalledTimes(1)
  } finally {confirm.mockRestore()}
})

it('keeps an order lookup failure separate from draft saving',async()=>{
  const episode={number:1,draft:{title:'1화',body:'기존',revision:4},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockResolvedValue(episode),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn().mockRejectedValue(new Error('후보 조회 실패')),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  await act(async()=>{await result.current.checkOrder()})
  expect(result.current.orderLookup).toEqual({status:'failed',message:'후보 조회 실패'})
  expect(result.current.error).toBe('')
  await act(async()=>{await result.current.save()})
  expect(api.writeEpisode).toHaveBeenCalledWith('w',1,episode.draft,true,expect.any(AbortSignal))
})

it('reports whether leaving the studio would lose work: clean may leave, dirty asks first, in-flight requests block',async()=>{
  const episode={number:1,draft:{title:'1화',body:'기존',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  let release:()=>void=()=>{}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockImplementation(()=>new Promise(resolve=>{release=()=>resolve(episode)})),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
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

const checkpointRows=[{versionId:'v1',publishedAt:'2026-11-01T00:00:00Z',active:false},{versionId:'v2',publishedAt:'2026-11-02T00:00:00Z',active:true}]
const checkpointEpisode={number:1,draft:{title:'1화',body:'기존',revision:3},versions:[],publishedVersionId:'v2',inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:checkpointRows}
const idleApi={setPublicationVisibility:vi.fn(),history:vi.fn(),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}

it('reverts to an earlier checkpoint by republishing that version and reports only the server result',async()=>{
  const reverted={...checkpointEpisode,draft:{...checkpointEpisode.draft,revision:4},publishedVersionId:'v1',checkpoints:checkpointRows.map(c=>({...c,active:c.versionId==='v1'}))}
  const api={...idleApi,writingList:vi.fn().mockResolvedValue([checkpointEpisode]),publishEpisode:vi.fn().mockResolvedValue(reverted)}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  let done=false
  await act(async()=>{done=await result.current.revertCheckpoint('v1',true)})
  expect(done).toBe(true)
  expect(api.publishEpisode).toHaveBeenCalledWith('w',1,3,'v1',true,expect.any(AbortSignal))
  expect(result.current.active?.checkpoints.map(c=>[c.versionId,c.active])).toEqual([['v1',true],['v2',false]])
  expect(result.current.notice).toContain('되돌렸어요')
  expect(result.current.error).toBe('')
})

it('does not announce a revert the server rejected and keeps the current checkpoint active',async()=>{
  const api={...idleApi,writingList:vi.fn().mockResolvedValue([checkpointEpisode]),publishEpisode:vi.fn().mockRejectedValue(new Error('공개 권리와 저장된 원고를 확인해 주세요.'))}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  let done=true
  await act(async()=>{done=await result.current.revertCheckpoint('v1',true)})
  expect(done).toBe(false)
  expect(result.current.error).toBe('공개 권리와 저장된 원고를 확인해 주세요.')
  expect(result.current.notice).toBe('')
  expect(result.current.active?.checkpoints.find(c=>c.active)?.versionId).toBe('v2')
})

it('공개 상태 실패는 기존 상태를 보존하고 재요청 성공만 반영한다',async()=>{
  const episode={number:1,draft:{title:'1화',body:'원고',revision:4},versions:[],publishedVersionId:'v1',publicationStatus:'published' as const,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const stopped={...episode,publishedVersionId:null,publicationStatus:'suspended' as const,draft:{...episode.draft,revision:5}}
  const api={setPublicationVisibility:vi.fn().mockRejectedValueOnce(new Error('공개 상태 충돌')).mockResolvedValue(stopped),history:vi.fn().mockResolvedValue({versions:[],proposals:[],publicationHistory:[]}),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
  try {
    const {result}=renderHook(()=>useWritingViewModel('w',api))
    await act(async()=>{})
    await act(async()=>{await result.current.loadPublicationHistory()})
    await act(async()=>{expect(await result.current.changeVisibility(false,false)).toBe(false)})
    expect(result.current.active?.publishedVersionId).toBe('v1')
    expect(result.current.error).toBe('공개 상태 충돌')
    expect(result.current.publicationHistory).toEqual([])
    await act(async()=>{expect(await result.current.changeVisibility(false,false)).toBe(true)})
    expect(result.current.active?.publicationStatus).toBe('suspended')
    expect(result.current.draft.revision).toBe(5)
    expect(result.current.publicationHistory).toBeNull()
    await act(async()=>{await result.current.loadPublicationHistory()})
    expect(result.current.publicationHistory).toEqual([])
  } finally {confirm.mockRestore()}
})


it('자동저장은 조회한 발행 이력을 유지하고 실제 발행 성공만 무효화한다',async()=>{
  vi.useFakeTimers()
  const episode={number:1,draft:{title:'1화',body:'기존 원고',revision:4},versions:[],publishedVersionId:'v1',inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const events=[{episode:1,versionId:'v1',publishedAt:'2026-11-09T00:00:00Z',action:'publish' as const}]
  const saved={...episode,draft:{...episode.draft,body:'수정 원고',revision:5}}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn().mockResolvedValue({versions:[],proposals:[],publicationHistory:events}),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockResolvedValue(saved),restoreEpisode:vi.fn(),publishEpisode:vi.fn().mockResolvedValue({...saved,publishedVersionId:'v2'}),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({body:'수정 원고'}))
  await act(async()=>{await result.current.loadPublicationHistory()})
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
  expect(api.writeEpisode).toHaveBeenCalledWith('w',1,{...episode.draft,body:'수정 원고'},false,expect.any(AbortSignal))
  expect(result.current.dirty).toBe(false)
  expect(result.current.publicationHistory).toEqual(events)
  expect(api.history).toHaveBeenCalledTimes(1)
  await act(async()=>{await result.current.publish('v2',true)})
  expect(result.current.publicationHistory).toBeNull()
})

it('발행 이력 조회 실패는 이력 오류로만 표시하고 자동저장을 멈추지 않는다',async()=>{
  vi.useFakeTimers()
  const episode={number:1,draft:{title:'1화',body:'기존',revision:4},versions:[],publishedVersionId:'v1',inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn().mockRejectedValue(new Error('이력 조회 실패')),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockResolvedValue({...episode,draft:{...episode.draft,body:'새 입력',revision:5}}),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  await act(async()=>{await result.current.loadPublicationHistory()})
  expect(result.current.historyError).toBe('이력 조회 실패')
  expect(result.current.error).toBe('')
  act(()=>result.current.edit({body:'새 입력'}))
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
  expect(api.writeEpisode).toHaveBeenCalledTimes(1)
})

it('공개 상태 변경 뒤 늦게 도착한 이전 발행 이력 응답은 무시한다',async()=>{
  const episode={number:1,draft:{title:'1화',body:'원고',revision:4},versions:[],publishedVersionId:'v1',publicationStatus:'published' as const,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  const stopped={...episode,publishedVersionId:null,publicationStatus:'suspended' as const,draft:{...episode.draft,revision:5}}
  let resolveHistory:(value:{versions:never[];proposals:never[];publicationHistory:{episode:number;versionId:string;publishedAt:string;action:'publish'}[]})=>void=()=>{}
  const api={setPublicationVisibility:vi.fn().mockResolvedValue(stopped),history:vi.fn().mockImplementation(()=>new Promise(resolve=>{resolveHistory=resolve})),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn(),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
  try {
    const {result}=renderHook(()=>useWritingViewModel('w',api))
    await act(async()=>{})
    let loading:Promise<void>=Promise.resolve()
    act(()=>{loading=result.current.loadPublicationHistory()})
    await act(async()=>{expect(await result.current.changeVisibility(false,false)).toBe(true)})
    await act(async()=>{resolveHistory({versions:[],proposals:[],publicationHistory:[{episode:1,versionId:'v1',publishedAt:'2026-11-09T00:00:00Z',action:'publish'}]});await loading})
    expect(result.current.publicationHistory).toBeNull()
    expect(result.current.historyLoading).toBe(false)
  } finally {confirm.mockRestore()}
})

it('autosaves note-only edits and preserves notes typed while saving', async () => {
  vi.useFakeTimers()
  const episode={number:1,draft:{title:'제목',body:'본문',authorNote:'',revision:0},versions:[],publishedVersionId:null,inherited:false,updatedAt:null,checkpointStatus:'content_only',checkpoints:[]}
  let resolveSave: (value:typeof episode)=>void=()=>{}
  const api={setPublicationVisibility:vi.fn(),history:vi.fn(),writingList:vi.fn().mockResolvedValue([episode]),createEpisode:vi.fn(),writeEpisode:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveSave=resolve})),restoreEpisode:vi.fn(),publishEpisode:vi.fn(),orderScope:vi.fn(),deleteDraft:vi.fn(),deleteEpisode:vi.fn()}
  const {result}=renderHook(()=>useWritingViewModel('w',api))
  await act(async()=>{})
  act(()=>result.current.edit({authorNote:'첫 후기'}))
  expect(result.current.dirty).toBe(true)
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
  expect(api.writeEpisode).toHaveBeenCalledWith('w',1,{...episode.draft,authorNote:'첫 후기'},false,expect.any(AbortSignal))
  act(()=>result.current.edit({authorNote:'추가 입력'}))
  await act(async()=>resolveSave({...episode,draft:{...episode.draft,authorNote:'첫 후기',revision:1}}))
  expect(result.current.draft.authorNote).toBe('추가 입력')
  expect(result.current.dirty).toBe(true)
})
