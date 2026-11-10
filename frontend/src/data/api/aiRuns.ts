import {z} from 'zod'
import {assertAuthVersion,authVersion,protectedRequest} from './auth'
import {csrf} from './csrf'
import type {AiRunRepository,RunInput,ChangeProposal,Progress} from '../../domain/entities/aiRun'

const messages={ANALYZING:'요청을 분석하고 있습니다.',CONTEXT_LOADING:'회차별 맥락을 확인하고 있습니다.',RELATIONS_LOADING:'인물 관계를 확인하고 있습니다.',TEXT_LOADING:'관련 원고를 찾고 있습니다.',TEMPLATE_SEARCH:'세계관 템플릿을 찾고 있습니다.',SIMULATING:'인물의 행동을 시뮬레이션하고 있습니다.',REVIEWING:'설정과 플롯을 검수하고 있습니다.',DRAFTING:'초안을 작성하고 있습니다.',EDITING:'선택한 문단을 수정하고 있습니다.',PROPOSAL_PENDING:'변경안을 확인해 주세요.',RESULT_READY:'결과가 준비되었습니다.',APPLIED:'변경사항을 저장했습니다.',PARTIAL:'일부 결과가 준비되었습니다.',FAILED:'작업을 완료하지 못했습니다.',CANCELLED:'작업을 취소했습니다.'}
const ref=z.string().min(1).max(128)
const status=z.enum(['pending','running','succeeded','partial','failed','denied','clarification','cancelled','proposal','awaiting_approval','applied','rejected','revision_requested'])
const runSchema=z.object({runId:ref,threadId:ref,workId:ref,status,lastEventId:z.number().int().nonnegative(),error:z.object({code:z.string(),retryable:z.boolean()}).nullish(),result:z.object({proposalId:ref.nullish(),isMock:z.boolean()}).nullish()})
const span=z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative()})
const proposalSchema=z.object({proposalHash:z.string().regex(/^[a-f0-9]{64}$/),status:z.string(),changeSet:z.object({proposalId:ref,proposalVersion:z.number().int().positive(),runId:ref,isMock:z.boolean(),affectedDocuments:z.array(z.object({id:ref,baseVersion:z.number().int().nullable()})),operations:z.array(z.object({op:z.string(),target:z.object({id:ref,episode:z.number().int(),baseVersion:z.number().int().nullable()}),span:span.nullish().transform(x=>x??null),content:z.string().nullish().transform(x=>x??null),fields:z.array(z.object({name:z.string(),value:z.string()}))})),evidence:z.array(z.object({id:ref,isMock:z.boolean(),sourceHash:z.string(),span}))})})
const detailsSchema=z.object({status,text:z.string(),isMock:z.boolean(),citations:z.array(z.object({quote:z.string(),episode:z.number().int()})),coverage:z.object({expectedCount:z.number().int(),verifiedCount:z.number().int(),gaps:z.array(z.string())}).nullable()})
export class AiRunHttpError extends Error {readonly status:number;constructor(status:number){super(status===409?'원고·선택 구간 또는 제안 판이 변경됐어요. 다시 불러온 뒤 검토해 주세요.':status===403||status===404?'현재 이 작업을 볼 권한이 없어요.':'AI 요청을 처리하지 못했어요. 같은 작업의 상태를 다시 확인해 주세요.');this.status=status}}
export function parseProgress(value:unknown,runId:string):Progress {
  const event=z.object({runId:ref,seq:z.number().int().positive(),code:z.enum(Object.keys(messages) as [keyof typeof messages,...(keyof typeof messages)[]])}).parse(value)
  if(event.runId!==runId)throw new Error('다른 작업의 진행 기록이에요.')
  return {...event,message:messages[event.code]}
}
export function nextCursor(cursor:number,event:Progress){if(event.seq<=cursor)return cursor;if(event.seq!==cursor+1)throw new Error('진행 기록을 다시 연결합니다.');return event.seq}

export class HttpAiRunRepository implements AiRunRepository {
  session(){return authVersion()}
  metadata(work:string,signal:AbortSignal){return this.request(`/api/v1/works/${encodeURIComponent(work)}`,z.object({revision:z.number().int().nonnegative(),source:z.object({workId:z.string()}).nullable()}),signal)}
  private path(work:string){return `/api/v1/works/${encodeURIComponent(work)}/ai`}
  private async request<T>(path:string,schema:z.ZodType<T>,signal:AbortSignal,body?:object,key?:string){
    const version=authVersion();const headers:Record<string,string>={Accept:'application/json'}
    if(body!==undefined){headers['Content-Type']='application/json';headers['X-CSRF-TOKEN']=await csrf(signal)}
    if(key)headers['Idempotency-Key']=key
    const response=await protectedRequest(path,{method:body===undefined?'GET':'POST',headers,signal,body:body===undefined?undefined:JSON.stringify(body)},version,false,{allowHttpError:true})
    if(!response.ok)throw new AiRunHttpError(response.status)
    const result=schema.parse(await response.json());assertAuthVersion(version);if(signal.aborted)throw new Error('요청을 중단했어요.');return result
  }
  create(work:string,input:RunInput,key:string,signal:AbortSignal){return this.request(`${this.path(work)}/runs`,runSchema,signal,input,key)}
  status(work:string,id:string,signal:AbortSignal){return this.request(`${this.path(work)}/runs/${encodeURIComponent(id)}`,runSchema,signal)}
  details(work:string,id:string,signal:AbortSignal){return this.request(`${this.path(work)}/runs/${encodeURIComponent(id)}/result`,detailsSchema,signal)}
  cancel(work:string,id:string,signal:AbortSignal){return this.request(`${this.path(work)}/runs/${encodeURIComponent(id)}/cancel`,runSchema,signal,{})}
  proposal(work:string,id:string,signal:AbortSignal){return this.request(`${this.path(work)}/proposals/${encodeURIComponent(id)}`,proposalSchema,signal)}
  decide(work:string,p:ChangeProposal,action:'approve'|'reject'|'revise',key:string,signal:AbortSignal){return this.request(`${this.path(work)}/proposals/${encodeURIComponent(p.changeSet.proposalId)}/${action}`,z.object({outcome:z.string(),decisionId:ref}),signal,{proposalVersion:p.changeSet.proposalVersion,proposalHash:p.proposalHash,baseVersions:p.changeSet.affectedDocuments.map(d=>({targetId:d.id,baseVersion:d.baseVersion}))},key)}
  async watch(work:string,id:string,cursor:number,signal:AbortSignal,onEvent:(e:Progress)=>void,onConnection:(live:boolean)=>void){
    const version=authVersion()
    while(!signal.aborted){
      assertAuthVersion(version)
      const connection=new AbortController();const stop=()=>connection.abort();signal.addEventListener('abort',stop,{once:true})
      const session=setInterval(()=>{try{assertAuthVersion(version)}catch{connection.abort()}},250)
      let idle:ReturnType<typeof setTimeout>|undefined
      const heartbeat=()=>{clearTimeout(idle);idle=setTimeout(stop,45000)}
      try{
        heartbeat()
        const response=await protectedRequest(`${this.path(work)}/runs/${encodeURIComponent(id)}/events`,{signal:connection.signal,headers:{Accept:'text/event-stream','Last-Event-ID':String(cursor)}},version,false,{allowHttpError:true})
        if(response.status===410){cursor=(await this.status(work,id,signal)).lastEventId;continue}
        if(!response.ok)throw new AiRunHttpError(response.status)
        if(!response.body)throw new Error('진행 연결이 없어요.')
        const reader=response.body.getReader();const cancelReader=()=>void reader.cancel().catch(()=>{});connection.signal.addEventListener('abort',cancelReader,{once:true})
        const decoder=new TextDecoder();let buffer='';onConnection(true)
        try{for(;;){const {done,value}=await reader.read();assertAuthVersion(version);if(signal.aborted||done)break;heartbeat();buffer+=decoder.decode(value,{stream:true});if(buffer.length>65536)throw new Error('진행 기록이 너무 커요.');buffer=buffer.replace(/\r\n/g,'\n');let end:number;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!frame.split('\n').some(l=>l.startsWith('event:')&&l.slice(6).trim()==='progress'))continue;const event=parseProgress(JSON.parse(frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')),id);const next=nextCursor(cursor,event);if(next!==cursor){assertAuthVersion(version);if(signal.aborted)break;cursor=next;onEvent(event)}}}}
        finally{connection.signal.removeEventListener('abort',cancelReader);await reader.cancel().catch(()=>{});reader.releaseLock()}
      }catch(error){assertAuthVersion(version);if(error instanceof AiRunHttpError&&[401,403,404].includes(error.status))throw error;if(!signal.aborted)onConnection(false)}
      finally{clearInterval(session);clearTimeout(idle);signal.removeEventListener('abort',stop);connection.abort()}
      if(!signal.aborted)await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve()};const timer=setTimeout(finish,1000);signal.addEventListener('abort',finish,{once:true})})
    }
  }
}
