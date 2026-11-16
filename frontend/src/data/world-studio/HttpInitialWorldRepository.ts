import {z} from 'zod'
import {authVersion,authenticatedUserId,protectedRequest} from '../api/auth'
import {csrf,withLock} from '../api/csrf'
import type {InitialWorldRepository} from '../../domain/repositories/InitialWorldRepository'
import type {MutationResult} from '../../domain/entities/initialWorld'
import {analysisSchema,decisionSchema,receiptSchema} from './initialWorldSchemas'
const pendingSchema=z.object({path:z.string().regex(/^(|\/[0-9a-f-]+\/applications|\/[0-9a-f-]+\/candidates\/[0-9a-f-]+\/decisions)$/),body:z.record(z.string(),z.unknown())})
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>
export class HttpInitialWorldRepository implements InitialWorldRepository {
 private readonly fetcher?:typeof fetch
 private readonly storage:StoragePort
 constructor(fetcher?:typeof fetch,storage:StoragePort=localStorage){this.fetcher=fetcher;this.storage=storage}
 acknowledge(world:string){this.storage.removeItem(this.key(world))}
 private key(world:string){z.uuid().parse(world);const member=authenticatedUserId();if(!member)throw new Error('로그인이 필요합니다.');return `storyfork:initial-world:${member}:${world}`}
 pending(world:string){const value=this.storage.getItem(this.key(world));return value?pendingSchema.parse(JSON.parse(value)):null}
 private async request<T>(world:string,path:string,schema:z.ZodType<T>,signal?:AbortSignal,body?:Record<string,unknown>):Promise<T>{
  z.uuid().parse(world);const version=authVersion(),headers:Record<string,string>={'Content-Type':'application/json'}
  const timeout=AbortSignal.timeout(120000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout
  if(body)headers['X-CSRF-TOKEN']=await csrf(requestSignal)
  const response=await protectedRequest(`/api/v1/world-studios/${world}/analyses${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:requestSignal},version,false,{fetcher:this.fetcher??fetch,allowHttpError:true})
  const data:unknown=await response.json(),parsed=schema.safeParse(data)
  // failed/unknown are real state DTOs even on 502/503, not successful mutations.
  if(parsed.success&&(response.ok||response.status===502||response.status===503))return parsed.data
  const error=z.object({detail:z.string()}).safeParse(data)
  throw new Error(error.success?error.data.detail:'응답을 확인하지 못했어요. 같은 요청으로 확인해 주세요.',{cause:[409,422].includes(response.status)?'rejected':undefined})
 }
 list(world:string,signal?:AbortSignal){return this.request(world,'',z.array(analysisSchema),signal)}
 async read(world:string,id:string,signal?:AbortSignal){z.uuid().parse(id);const a=await this.request(world,`/${id}`,analysisSchema,signal);if(a.analysisId!==id)throw new Error('다른 분석 응답입니다.');return a}
 async receipt(world:string,analysis:string,id:string,signal?:AbortSignal){z.uuid().parse(analysis);z.uuid().parse(id);const r=await this.request(world,`/${analysis}/applications/${id}`,receiptSchema,signal);if(r.applicationId!==id)throw new Error('다른 반영 응답입니다.');return r}
 async mutate(world:string,path:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<MutationResult>{
  const storageKey=this.key(world)
  return withLock(storageKey,async()=>{
   const previous=this.pending(world)
   if(previous&&(previous.path!==path||JSON.stringify({...previous.body,key:undefined})!==JSON.stringify({...body,key:undefined})))throw new Error('미확인 요청이 있어요. 먼저 같은 요청으로 결과를 확인해 주세요.')
   const pending=previous??pendingSchema.parse({path,body:{...body,key:crypto.randomUUID()}})
   // Persist before sending; failure to retain the key prevents a write.
   this.storage.setItem(storageKey,JSON.stringify(pending))
   const schema=path.endsWith('/applications')?receiptSchema:path.endsWith('/decisions')?decisionSchema:analysisSchema
   try{
    const result=await this.request<MutationResult>(world,path,schema,signal,pending.body)
    if('candidateId'in result&&(result.candidateId!==path.split('/')[3]||result.sequence!==Number(pending.body.expectedDecisionSequence)+1))throw new Error('검토 응답이 요청과 일치하지 않아요. 같은 요청으로 확인하세요.')
    if('applicationId'in result&&result.baseDraftRevision!==pending.body.expectedDraftRevision)throw new Error('반영 기준을 확인하지 못했어요. 같은 요청으로 확인하세요.')
    // Only a running analysis can still change under this key; the server never re-runs failed/unknown, so keeping them would lock out a new analysis.
    if('applicationId'in result?result.status==='failed':'analysisId'in result?result.executionStatus!=='running':true)this.storage.removeItem(storageKey)
    return result
   }catch(error){if(error instanceof Error&&error.cause==='rejected')this.storage.removeItem(storageKey);throw error}
  },true)
 }
 resume(world:string,signal?:AbortSignal){const p=this.pending(world);if(!p)throw new Error('확인할 요청이 없어요.');return this.mutate(world,p.path,p.body,signal)}
}
