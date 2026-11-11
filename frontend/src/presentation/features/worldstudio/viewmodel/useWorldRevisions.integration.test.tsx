// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {Provider} from 'react-redux'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import type {ReactNode} from 'react'
import {createAppStore} from '../../../../app/store'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import type {WorldStudioRepository} from '../../../../domain/repositories/WorldStudioRepository'
import type {StudioWorld,WorldRevision,WorldRevisionSummary} from '../../../../domain/entities/studioWorld'
import {sessionActions} from '../../../shared/session/sessionSlice'
import {useWorldRevisions} from './useWorldRevisions'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
beforeEach(()=>{vi.stubGlobal('navigator',{locks:{request:vi.fn(async(_name,_options,action)=>action({}))}})})
const world:StudioWorld={id:crypto.randomUUID(),name:'초안',description:'작성 중',version:2,currentRevisionId:null,settings:[],analysis:null}
const frozen:WorldRevision={worldId:world.id,revisionId:crypto.randomUUID(),revisionNo:1,name:'확정',description:'불변 원문',parentRevisionId:null,restoredFromRevisionId:null,cards:[],relationships:null,relationshipStatus:'not_recorded'}
function setup(dirty=false,reload=vi.fn(async()=>({...world,version:3,currentRevisionId:frozen.revisionId}))){
 let pending:{expectedDraftRevision:number;key:string}|null=null
 let rows:WorldRevisionSummary[]=[]
 const repo:WorldStudioRepository={listStudio:vi.fn(),read:vi.fn(),create:vi.fn(),saveStudio:vi.fn(),revisions:vi.fn(async()=>rows),revision:vi.fn(async()=>frozen),confirm:vi.fn(async()=>{pending={key:'same',expectedDraftRevision:2};rows=[{worldId:world.id,revisionId:frozen.revisionId,revisionNo:1,name:'확정',createdAt:'2026-11-11T00:00:00Z'}];return frozen}),pendingConfirmation:()=>pending,acknowledgeConfirmation:vi.fn(()=>{pending=null})}
 const uc=new WorldStudioUseCase(repo),lock=vi.fn(),store=createAppStore({role:'user',memberId:'owner'})
 const wrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
 const mount=()=>renderHook(({isDirty=dirty,id=world.id,active=true,saved=world}={})=>useWorldRevisions(id,active,saved,isDirty,reload,lock,uc,null),{wrapper})
 return {...mount(),repo,reload,mount,store}

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

function laterRows(id=crypto.randomUUID()):WorldRevisionSummary[]{return [
 {worldId:world.id,revisionId:frozen.revisionId,revisionNo:1,name:'확정',createdAt:'2026-11-11T00:00:00Z'},
 {worldId:world.id,revisionId:id,revisionNo:2,name:'다음 확정',createdAt:'2026-11-11T01:00:00Z'},
]}
async function supersededSetup(){
 const rows=laterRows(),latest={...world,version:4,currentRevisionId:rows[1].revisionId}
 const view=setup(false,vi.fn(async()=>latest))
 await waitFor(()=>expect(view.result.current.busy).toBe(false))
 vi.mocked(view.repo.revisions!).mockResolvedValue(rows)
 await act(()=>view.result.current.confirm())
 return {...view,latest}
}
it('acknowledges explicitly without another POST, then allows a new confirmation on the refreshed draft',async()=>{
 const v=await supersededSetup()
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
 await act(()=>Promise.all([v.result.current.acknowledgeSuperseded(),v.result.current.acknowledgeSuperseded()]))
 expect(v.repo.confirm).toHaveBeenCalledTimes(1)
 expect(v.repo.acknowledgeConfirmation).toHaveBeenCalledTimes(1)
 expect(v.result.current.pending).toBe(false)
 expect(v.result.current.superseded).toBeNull()
 v.rerender({saved:v.latest})
 await act(()=>v.result.current.confirm())
 expect(v.repo.confirm).toHaveBeenLastCalledWith(world.id,4,expect.any(AbortSignal))
})
it.each(['detail','list','current','identity'] as const)('retains uncertainty when %s cannot verify the original keyed response',async failure=>{
 const v=setup();await waitFor(()=>expect(v.result.current.busy).toBe(false))
 if(failure==='detail')vi.mocked(v.repo.revision!).mockRejectedValue(new Error('unavailable'))
 if(failure==='list')vi.mocked(v.repo.revisions!).mockResolvedValue([])
 if(failure==='current')v.reload.mockResolvedValue({...world,version:4,currentRevisionId:crypto.randomUUID()})
 if(failure==='identity')vi.mocked(v.repo.revision!).mockResolvedValue({...frozen,revisionId:crypto.randomUUID()})
 await act(()=>v.result.current.confirm())
 expect(v.result.current.superseded).toBeNull();expect(v.result.current.pending).toBe(true)
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})
it('restores the same request after response loss and remount, without clearing it before explicit acknowledgement',async()=>{
 const v=await supersededSetup();v.unmount()
 const next=v.mount();await waitFor(()=>expect(next.result.current.busy).toBe(false))
 expect(next.result.current.pending).toBe(true);expect(next.result.current.superseded).toBeNull()
 vi.mocked(v.repo.confirm!).mockRejectedValueOnce(new Error('response lost'))
 await act(()=>next.result.current.confirm(true))
 expect(next.result.current.pending).toBe(true)
 await act(()=>next.result.current.confirm(true))
 expect(next.result.current.superseded?.revisionNo).toBe(1)
 expect(v.repo.confirm).toHaveBeenLastCalledWith(world.id,2,expect.any(AbortSignal))
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})
it('does not clear a different request created by another tab while awaiting acknowledgement',async()=>{
 const v=await supersededSetup()
 v.repo.pendingConfirmation=()=>({key:'other-tab',expectedDraftRevision:4})
 await act(()=>v.result.current.acknowledgeSuperseded())
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled();expect(v.repo.confirm).toHaveBeenCalledTimes(1)
})
it('protects unsaved input and retains the request if reloading during acknowledgement fails',async()=>{
 const v=await supersededSetup();v.rerender({isDirty:true})
 await act(()=>v.result.current.acknowledgeSuperseded())
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
 v.rerender({isDirty:false});v.reload.mockRejectedValueOnce(new Error('offline'))
 await act(()=>v.result.current.acknowledgeSuperseded())
 expect(v.result.current.pending).toBe(true);expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})
it('does not issue a request when another tab holds the confirmation UI lock',async()=>{
 const v=setup();await waitFor(()=>expect(v.result.current.busy).toBe(false))
 vi.stubGlobal('navigator',{locks:{request:vi.fn(async(_name,_options,action)=>action(null))}})
 await act(()=>v.result.current.confirm())
 expect(v.repo.confirm).not.toHaveBeenCalled()
})
it('ignores late acknowledgement after leaving the world',async()=>{
 const v=await supersededSetup()
 let release!:(value:StudioWorld)=>void
 v.reload.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}))
 let completion!:Promise<void>
 act(()=>{completion=v.result.current.acknowledgeSuperseded()})
 await waitFor(()=>expect(release).toBeDefined())
 v.rerender({active:false})
 await act(async()=>{release(v.latest);await completion})
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})

it('clears only scoped UI evidence on logout and restores the pending request after login',async()=>{
 const v=await supersededSetup()
 act(()=>{v.store.dispatch(sessionActions.logout())})
 expect(v.result.current.superseded).toBeNull()
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
 act(()=>{v.store.dispatch(sessionActions.login({id:'owner',email:'owner@example.test',nickname:'owner',operator:false}))})
 await waitFor(()=>expect(v.result.current.busy).toBe(false))
 await act(()=>v.result.current.confirm(true))
 expect(v.result.current.superseded?.revisionNo).toBe(1)
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})
it('never creates a new request when another tab already removed the pending recovery record',async()=>{
 const v=await supersededSetup();v.repo.pendingConfirmation=()=>null
 await act(()=>v.result.current.confirm(true))
 expect(v.repo.confirm).toHaveBeenCalledTimes(1)
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
})
it('rechecks the request after asynchronous verification before deleting any record',async()=>{
 const v=await supersededSetup()
 v.reload.mockImplementationOnce(async()=>{v.repo.pendingConfirmation=()=>({key:'replacement',expectedDraftRevision:4});return v.latest})
 await act(()=>v.result.current.acknowledgeSuperseded())
 expect(v.repo.acknowledgeConfirmation).not.toHaveBeenCalled()
 expect(v.result.current.superseded).toBeNull()
})
