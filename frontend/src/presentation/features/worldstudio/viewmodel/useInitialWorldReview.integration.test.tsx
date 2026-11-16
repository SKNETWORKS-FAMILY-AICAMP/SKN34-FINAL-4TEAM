// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {Provider} from 'react-redux'
import {afterEach,it,expect,vi} from 'vitest'
import type {ReactNode} from 'react'
import {createAppStore} from '../../../../app/store'
import {InitialWorldUseCase} from '../../../../domain/usecases/InitialWorldUseCase'
import type {InitialWorldRepository} from '../../../../domain/repositories/InitialWorldRepository'
import type {Analysis,Receipt} from '../../../../domain/entities/initialWorld'
import {useInitialWorldReview} from './useInitialWorldReview'
afterEach(cleanup)
const world=crypto.randomUUID(),analysis:Analysis={analysisId:crypto.randomUUID(),basis:{draftRevision:2,relationshipVersion:1,currentRevisionId:null,inputHash:'hash'},executionStatus:'completed',freshness:'current',output:{schemaVersion:'initial-world.v1',candidates:[],diagnostics:[]},candidateIds:{},decisions:[]}
const receipt:Receipt={applicationId:crypto.randomUUID(),status:'applied',baseDraftRevision:2,resultDraftRevision:3,createdCardIds:[],createdRelationshipIds:[]}
function setup(reload=vi.fn(async()=>{})){
 let pending=true
 const repo:InitialWorldRepository={list:vi.fn(async()=>[analysis]),read:vi.fn(),receipt:vi.fn(async()=>receipt),pending:()=>pending?{path:`/${analysis.analysisId}/applications`,body:{key:'same'}}:null,mutate:vi.fn(),resume:vi.fn(async()=>receipt),acknowledge:vi.fn(()=>{pending=false})}
 const useCase=new InitialWorldUseCase(repo),lock=vi.fn(),store=createAppStore({role:'user',memberId:'owner'})
 const wrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
 const hook=renderHook(()=>useInitialWorldReview(world,true,false,2,reload,lock,useCase),{wrapper})
 return {...hook,repo,reload}
}
it('recovers with the same request and confirms receipt plus server reload before success',async()=>{
 const {result,repo,reload}=setup();await waitFor(()=>expect(result.current.pending).toBe(true))
 await act(()=>result.current.recover())
 expect(repo.resume).toHaveBeenCalledTimes(1);expect(repo.receipt).toHaveBeenCalledWith(world,analysis.analysisId,receipt.applicationId,expect.any(AbortSignal));expect(reload).toHaveBeenCalledTimes(1)
 expect(result.current.message).toContain('초안에 반영');expect(result.current.pending).toBe(false)
})
it('retains the request and does not show success if the draft reload fails',async()=>{
 const {result,repo}=setup(vi.fn(async()=>{throw new Error('조회 실패')}));await waitFor(()=>expect(result.current.pending).toBe(true))
 await act(()=>result.current.recover());expect(result.current.error).toBe('조회 실패');expect(result.current.message).toBe('');expect(result.current.receipt).toBeNull();expect(repo.acknowledge).not.toHaveBeenCalled()
})

it('blocks a second click while recovery is awaiting its response',async()=>{
 const {result,repo}=setup();await waitFor(()=>expect(result.current.pending).toBe(true))
 let finish!:(value:Receipt)=>void
 vi.mocked(repo.resume).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 let request!:Promise<void>
 act(()=>{request=result.current.recover();void result.current.recover()})
 expect(repo.resume).toHaveBeenCalledTimes(1)
 await act(async()=>{finish({...receipt,status:'unknown',resultDraftRevision:null});await request})
 expect(result.current.pending).toBe(true);expect(result.current.message).toContain('미확인')
})

it('unlocks the screen while retaining uncertainty when login expires during recovery',async()=>{
 const {result,repo}=setup();await waitFor(()=>expect(result.current.pending).toBe(true))
 vi.mocked(repo.resume).mockRejectedValue(new Error('로그인이 필요합니다.'))
 vi.spyOn(repo,'pending').mockImplementation(()=>{throw new Error('로그인이 필요합니다.')})
 await act(()=>result.current.recover())
 expect(result.current.busy).toBe(false);expect(result.current.pending).toBe(true);expect(result.current.error).toBe('로그인이 필요합니다.')
})
