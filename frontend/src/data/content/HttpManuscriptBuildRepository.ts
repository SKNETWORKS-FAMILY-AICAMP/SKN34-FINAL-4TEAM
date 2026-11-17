import {z} from 'zod'
import type {ManuscriptBuildRepository} from '../../domain/repositories/ManuscriptBuildRepository'
import {authenticatedUserId,authVersion,assertAuthVersion,protectedRequest} from '../api/auth'
import {csrf,withLock} from '../api/csrf'
const uuid=z.string().uuid(),count=z.number().int().nonnegative()
const receipt=z.object({jobId:uuid,stepId:uuid,worldId:uuid,draftRevision:count,relationshipVersion:count,cardIds:z.array(uuid),relationshipIds:z.array(uuid)})
const result=z.object({jobId:uuid,worldId:uuid,status:z.enum(['queued','running','failed','loading','unknown','completed']),completedEpisodes:count,totalEpisodes:count.positive(),executionToken:uuid.nullable(),failureCode:z.string().nullable(),receipts:z.array(receipt)}).refine(r=>r.completedEpisodes<=r.totalEpisodes&&r.receipts.every(x=>x.jobId===r.jobId&&x.worldId===r.worldId)&&new Set(r.receipts.map(x=>x.stepId)).size===r.receipts.length&&(r.status!=='completed'||r.completedEpisodes===r.totalEpisodes&&r.receipts.length>0))
const request=z.object({worldId:uuid,key:uuid,consent:z.literal(true)})
const path=(work:string)=>`/api/v1/works/${uuid.parse(work)}/world-preprocessing`
/** 계정·작품별 최초 key를 전송 전에 보존한다. 실패나 재로그인 때문에 새 key를 만들지 않는다. */
export class HttpManuscriptBuildRepository implements ManuscriptBuildRepository {
 private readonly fetcher:typeof fetch
 constructor(fetcher:typeof fetch=fetch){this.fetcher=fetcher}
 private slot(work:string){
  const owner=authenticatedUserId();if(!owner)throw new Error('로그인이 필요해요.')
  uuid.parse(work);return `storyfork-manuscript-build:${owner}:${work}`
 }
 private saved(slot:string){
  const raw=localStorage.getItem(slot)
  if(!raw)return null
  const parsed=request.safeParse(JSON.parse(raw));if(!parsed.success)throw new Error('기존 요청 기록을 확인할 수 없어요. 새 요청을 보내지 않았어요.')
  return parsed.data
 }
 private async send(work:string,body?:object,signal?:AbortSignal){
  const version=authVersion(),timeout=AbortSignal.timeout(20000),combined=signal?AbortSignal.any([signal,timeout]):timeout
  const response=await protectedRequest(path(work),{method:body?'POST':'GET',signal:combined,...(body?{body:JSON.stringify(body),headers:{'Content-Type':'application/json','X-CSRF-TOKEN':await csrf(combined)}}:{})},version,false,{fetcher:this.fetcher,allowHttpError:true})
  if(!body&&response.status===404)return null
  if(!response.ok){
   const detail=await response.json().catch(()=>null)
   throw new Error(response.status===503?'현재 원고 세계관 구축을 사용할 수 없어요. 요청 기록은 유지했어요.':detail?.detail??'작업을 확인하지 못했어요. 같은 요청으로 상태를 다시 확인해 주세요.')
  }
  const data=result.safeParse(await response.json());assertAuthVersion(version)
  if(!data.success)throw new Error('저장 완료를 확인할 수 없어요. 요청 기록을 유지했어요.')
  return data.data
 }
 async read(work:string,signal?:AbortSignal){
  this.slot(work);return this.send(work,undefined,signal)
 }
 async start(work:string,world?:string|null,signal?:AbortSignal){
  const slot=this.slot(work),version=authVersion()
  return withLock(slot,async()=>{
   assertAuthVersion(version)
   let body=this.saved(slot)
   if(!body){body={worldId:world??crypto.randomUUID(),key:crypto.randomUUID(),consent:true};request.parse(body);localStorage.setItem(slot,JSON.stringify(body))}
   const data=await this.send(work,body,signal)
   if(!data||data.worldId!==body.worldId)throw new Error('기존 요청과 세계관이 달라요.')
   return data
  },true)
 }
 async resume(work:string,signal?:AbortSignal){
  const slot=this.slot(work),version=authVersion()
  return withLock(slot,async()=>{
   assertAuthVersion(version)
   const body=this.saved(slot);if(!body)throw new Error('이 브라우저에 원래 요청 기록이 없어요. 시작한 브라우저에서 재개해 주세요.')
   const current=await this.send(work,undefined,signal)
   if(!current)return this.send(work,body,signal).then(r=>{if(!r)throw new Error('작업을 확인하지 못했어요.');return r})
   if(current.worldId!==body.worldId)throw new Error('기존 요청과 세계관이 달라요.')
   if(['queued','running','completed'].includes(current.status))return current
   const retry=current.status==='failed'||current.failureCode==='EXECUTION_EXPIRED'
   if(retry&&!current.executionToken)throw new Error('재개할 실행 기록을 확인할 수 없어요.')
   const data=await this.send(work,{...body,...(retry?{resumeToken:current.executionToken}:{})},signal)
   if(!data||data.worldId!==body.worldId)throw new Error('기존 작업을 확인하지 못했어요.')
   return data
  },true)
 }
}
