// @vitest-environment jsdom
import {act,renderHook,waitFor,cleanup} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Provider} from 'react-redux'
import type {ReactNode} from 'react'
import {asValue} from 'awilix/browser'
import {appContainer} from '../../../../app/appContainer'
import {createAppStore} from '../../../../app/store'
import {sessionActions} from '../../../shared/session/sessionSlice'
import {AiRunUseCase} from '../../../../domain/usecases/AiRunUseCase'
import type {AiRunRepository,ChangeProposal} from '../../../../domain/entities/aiRun'
import {useAiRunViewModel} from './useAiRunViewModel'

afterEach(cleanup)
function fixture(status='proposal'){
  const proposal:ChangeProposal={status:'pending',proposalHash:'a'.repeat(64),changeSet:{proposalId:'p',proposalVersion:1,runId:'r',isMock:false,affectedDocuments:[{id:'d',baseVersion:0}],operations:[],evidence:[]}}
  const repo:AiRunRepository={session:()=>0,metadata:vi.fn(async()=>({revision:0,source:null})),create:vi.fn(async()=>({runId:'r',threadId:'t',workId:'w',status,lastEventId:0,result:status==='proposal'?{proposalId:'p',isMock:false}:null})),status:vi.fn(async()=>({runId:'r',threadId:'t',workId:'w',status:'running',lastEventId:0})),details:vi.fn(),proposal:vi.fn(async()=>proposal),decide:vi.fn(async()=>({outcome:'applied',decisionId:'decision'})),cancel:vi.fn(async()=>({runId:'r',threadId:'t',workId:'w',status:'cancelled',lastEventId:1})),watch:vi.fn(async(_w,_r,_c,_s,_e,connection)=>{connection(false)})}
  appContainer.register({aiRunUseCase:asValue(new AiRunUseCase(repo))})
  const store=createAppStore({role:'user',memberId:'member'})
  const applied=vi.fn()
  const hook=renderHook(({body})=>useAiRunViewModel('w',1,0,body,{start:0,end:0},true,applied),{initialProps:{body:'원고'},wrapper:({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>})
  return {repo,store,applied,...hook}
}
async function start(f:ReturnType<typeof fixture>){act(()=>{f.result.current.setPrompt('질문');f.result.current.setConsent(true)});await act(async()=>{void f.result.current.start()});await waitFor(()=>expect(f.result.current.state?.run).toBeDefined())}
it('승인 전 원고를 바꾸지 않고 중복 승인은 한 번만 요청한다',async()=>{
  const f=fixture();await start(f);expect(f.applied).not.toHaveBeenCalled()
  await act(async()=>{await Promise.all([f.result.current.decide('approve'),f.result.current.decide('approve')])})
  expect(f.repo.decide).toHaveBeenCalledTimes(1);expect(f.applied).toHaveBeenCalledTimes(1)
})
it('원고 또는 세션 변경 직후 이전 제안을 숨긴다',async()=>{
  const f=fixture();await start(f);expect(f.result.current.state?.proposal).toBeDefined()
  f.rerender({body:'바뀐 원고'});expect(f.result.current.state?.proposal).toBeUndefined()
  act(()=>f.store.dispatch(sessionActions.logout()));expect(f.result.current.state?.run).toBeUndefined()
})
it('단절은 취소가 아니며 실행 중 요청 중복과 사용자 취소를 구분한다',async()=>{
  const f=fixture('running');await start(f)
  expect(f.result.current.connected).toBe(false);expect(f.result.current.state?.run?.status).toBe('running')
  await act(async()=>{void f.result.current.start()});expect(f.repo.create).toHaveBeenCalledTimes(1)
  await act(async()=>{await f.result.current.cancel()});expect(f.result.current.state?.run?.status).toBe('cancelled')
})
it('권한 철회 응답은 이전 제안을 지운다',async()=>{
  const f=fixture();await start(f)
  vi.mocked(f.repo.decide).mockRejectedValue(Object.assign(new Error('권한 없음'),{status:403}))
  await act(async()=>{await f.result.current.decide('approve')})
  expect(f.result.current.state?.proposal).toBeUndefined()
})
it('접수 응답 유실 후 재시도는 원래 body와 키를 재사용한다',async()=>{
  const f=fixture();vi.mocked(f.repo.create).mockRejectedValueOnce(new Error('응답 유실'))
  act(()=>{f.result.current.setPrompt('질문');f.result.current.setConsent(true)})
  await act(async()=>{await f.result.current.start()})
  vi.mocked(f.repo.metadata).mockResolvedValue({revision:9,source:null})
  await act(async()=>{await f.result.current.start()})
  const calls=vi.mocked(f.repo.create).mock.calls
  expect(calls[0][1]).toEqual(calls[1][1]);expect(calls[0][2]).toBe(calls[1][2])
})
it('확정 종료된 작업 이후 같은 질문은 새 접수 키를 사용한다',async()=>{
  const f=fixture('failed');await start(f)
  await act(async()=>{await f.result.current.start()})
  const calls=vi.mocked(f.repo.create).mock.calls
  expect(calls).toHaveLength(2);expect(calls[0][2]).not.toBe(calls[1][2])
})
