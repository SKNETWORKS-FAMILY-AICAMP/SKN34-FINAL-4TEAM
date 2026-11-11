// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {Provider} from 'react-redux'
import {afterEach,it,expect,vi} from 'vitest'
import type {ReactNode} from 'react'
import {createAppStore} from '../../../../app/store'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import type {WorldStudioRepository} from '../../../../domain/repositories/WorldStudioRepository'
import type {StudioWorld,WorldRevision,WorldRevisionSummary} from '../../../../domain/entities/studioWorld'
import {useWorldRevisions} from './useWorldRevisions'
afterEach(cleanup)
const world:StudioWorld={id:crypto.randomUUID(),name:'초안',description:'작성 중',version:2,currentRevisionId:null,settings:[],analysis:null}
const frozen:WorldRevision={worldId:world.id,revisionId:crypto.randomUUID(),revisionNo:1,name:'확정',description:'불변 원문',parentRevisionId:null,restoredFromRevisionId:null,cards:[],relationships:null,relationshipStatus:'not_recorded'}
function setup(dirty=false,reload=vi.fn(async()=>({...world,version:3,currentRevisionId:frozen.revisionId}))){
 let pending:{expectedDraftRevision:number;key:string}|null=null
 let rows:WorldRevisionSummary[]=[]
 const repo:WorldStudioRepository={listStudio:vi.fn(),read:vi.fn(),create:vi.fn(),saveStudio:vi.fn(),revisions:vi.fn(async()=>rows),revision:vi.fn(async()=>frozen),confirm:vi.fn(async()=>{pending={key:'same',expectedDraftRevision:2};rows=[{worldId:world.id,revisionId:frozen.revisionId,revisionNo:1,name:'확정',createdAt:'2026-11-11T00:00:00Z'}];return frozen}),pendingConfirmation:()=>pending,acknowledgeConfirmation:vi.fn(()=>{pending=null})}
 const uc=new WorldStudioUseCase(repo),lock=vi.fn(),store=createAppStore({role:'user',memberId:'owner'})
 const wrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
 return {...renderHook(()=>useWorldRevisions(world.id,true,world,dirty,reload,lock,uc,null),{wrapper}),repo,reload}
}
it('confirms separately without saving the draft and verifies detail/list/current draft before acknowledging',async()=>{
 const {result,repo,reload}=setup();await waitFor(()=>expect(result.current.busy).toBe(false))
 await act(()=>result.current.confirm())
 expect(repo.saveStudio).not.toHaveBeenCalled();expect(repo.confirm).toHaveBeenCalledWith(world.id,2,expect.any(AbortSignal));expect(reload).toHaveBeenCalledTimes(1)
 expect(result.current.detail).toEqual(frozen);expect(result.current.message).toContain('발행은 하지');expect(repo.acknowledgeConfirmation).toHaveBeenCalledTimes(1)
})
it('blocks confirmation with unsaved input',async()=>{
 const {result,repo}=setup(true);await waitFor(()=>expect(result.current.busy).toBe(false));await act(()=>result.current.confirm())
 expect(repo.confirm).not.toHaveBeenCalled();expect(result.current.error).toContain('먼저 저장')
})
it('retains confirmation uncertainty without a success message when the draft reload fails',async()=>{
 const {result,repo}=setup(false,vi.fn(async()=>{throw new Error('재조회 실패')}));await waitFor(()=>expect(result.current.busy).toBe(false));await act(()=>result.current.confirm())
 expect(result.current.pending).toBe(true);expect(result.current.message).toBe('');expect(repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})

it('recognizes an existing original confirmation superseded by another tab without clearing its request',async()=>{
 const later=crypto.randomUUID()
 const {result,repo}=setup(false,vi.fn(async()=>({...world,version:4,currentRevisionId:later})))
 await waitFor(()=>expect(result.current.busy).toBe(false))
 vi.mocked(repo.revisions!).mockResolvedValue([
  {worldId:world.id,revisionId:frozen.revisionId,revisionNo:1,name:'확정',createdAt:'2026-11-11T00:00:00Z'},
  {worldId:world.id,revisionId:later,revisionNo:2,name:'다음 확정',createdAt:'2026-11-11T01:00:00Z'},
 ])
 await act(()=>result.current.confirm())
 expect(result.current.pending).toBe(true)
 expect(result.current).toMatchObject({superseded:{revisionNo:1,currentRevisionNo:2}})
 expect(result.current.error).toBe('')
 expect(repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})
