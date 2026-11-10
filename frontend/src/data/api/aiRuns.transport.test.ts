import {afterEach,expect,it,vi} from 'vitest'
const auth=vi.hoisted(()=>({version:0,request:vi.fn()}))
vi.mock('./auth',()=>({authVersion:()=>auth.version,assertAuthVersion:(v:number)=>{if(v!==auth.version)throw new Error('session changed')},protectedRequest:auth.request}))
vi.mock('./csrf',()=>({csrf:async()=> 'fixture-csrf'}))
import {HttpAiRunRepository} from './aiRuns'
import type {RunInput} from '../../domain/entities/aiRun'
afterEach(()=>{auth.version=0;auth.request.mockReset();vi.useRealTimers()})
const run={runId:'r',threadId:'t',workId:'w',status:'running',lastEventId:0}
const input:RunInput={operation:'ask',prompt:'질문',target:{basisEpisode:1,forkId:null,character:'',baseRevision:2},options:{modelConsent:{providers:['openai'],purpose:'ask',maxCalls:1,noticeVersion:'v1'}}}
it('접수 키·CSRF·대상을 보존하고 취소는 새 실행을 만들지 않는다',async()=>{
  auth.request.mockResolvedValue(Response.json(run))
  const api=new HttpAiRunRepository();const signal=new AbortController().signal
  await api.create('w',input,'same-key',signal)
  expect(auth.request.mock.calls[0][1]).toMatchObject({method:'POST',headers:{'Idempotency-Key':'same-key','X-CSRF-TOKEN':'fixture-csrf'},body:JSON.stringify(input)})
  auth.request.mockResolvedValue(Response.json({...run,status:'cancelled'}))
  await api.cancel('w','r',signal)
  expect(auth.request.mock.calls[1][0]).toBe('/api/v1/works/w/ai/runs/r/cancel')
})
it('JSON 수신 중 계정이 바뀌면 결과를 반환하지 않는다',async()=>{
  let resolve!:(v:unknown)=>void
  const response=Response.json(run);vi.spyOn(response,'json').mockImplementation(()=>new Promise(r=>{resolve=r}))
  auth.request.mockResolvedValue(response)
  const pending=new HttpAiRunRepository().status('w','r',new AbortController().signal)
  await vi.waitFor(()=>expect(resolve).toBeDefined());auth.version=1;resolve(run)
  await expect(pending).rejects.toThrow('session changed')
})
it('단절 후 같은 cursor로 재접속하고 410이면 상태의 최신 cursor를 사용한다',async()=>{
  vi.useFakeTimers();const stop=new AbortController();const events:number[]=[];let streams=0
  auth.request.mockImplementation(async(path:string)=>{
    if(!path.endsWith('/events'))return Response.json({...run,lastEventId:3})
    streams++
    if(streams===2)return new Response('',{status:410})
    const seq=streams===1?1:4
    return new Response(`id: ${seq}\nevent: progress\ndata: ${JSON.stringify({runId:'r',seq,code:'ANALYZING'})}\n\n`,{headers:{'Content-Type':'text/event-stream'}})
  })
  const pending=new HttpAiRunRepository().watch('w','r',0,stop.signal,e=>{events.push(e.seq);if(e.seq===4)stop.abort()},()=>{})
  await vi.advanceTimersByTimeAsync(2000);await pending
  expect(events).toEqual([1,4])
  const calls=auth.request.mock.calls.filter(c=>c[0].endsWith('/events'))
  expect(calls.map(c=>c[1].headers['Last-Event-ID'])).toEqual(['0','1','3'])
  expect(auth.request.mock.calls.every(c=>!c[1].method||c[1].method==='GET')).toBe(true)
})
