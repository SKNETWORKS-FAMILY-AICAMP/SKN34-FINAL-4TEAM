import { z } from 'zod'
import { ImageRequestRejected, type ImageGenerationRepository, type ImageRequest } from '../../domain/repositories/ImageGenerationRepository'
import { protectedRequest } from './auth'
import { csrf } from './csrf'
const job = z.object({jobId:z.uuid(),status:z.enum(['accepted','queued','running','succeeded','failed','interrupted']),stage:z.string(),previewUrl:z.string().nullable()})
const httpErrors = {allowHttpError:true}
export class HttpImageGenerationRepository implements ImageGenerationRepository {
 /** 4xx는 서버가 준 안내(ContentErrorResponse.detail)를 담은 ImageRequestRejected로, 네트워크 오류·5xx는 일반 오류로 던진다. */
 async submit(input:ImageRequest,key:string,signal?:AbortSignal) {
  const token=await csrf(signal)
  const {referenceFile,...request}=input
  const headers={'X-CSRF-TOKEN':token,'Idempotency-Key':key}
  const json=JSON.stringify(request)
  let response:Response
  if (referenceFile) {
   const body=new FormData()
   body.set('request',new Blob([json],{type:'application/json'}),'request.json')
   body.set('file',referenceFile)
   response=await protectedRequest('/api/v1/image-generations/with-reference',{method:'POST',signal,headers,body},undefined,false,httpErrors)
  } else {
   response=await protectedRequest('/api/v1/image-generations',{method:'POST',signal,
    headers:{...headers,'Content-Type':'application/json'},body:json},undefined,false,httpErrors)
  }
  if(response.status>=400&&response.status<500) {
   const error=z.object({detail:z.string()}).safeParse(await response.json().catch(()=>undefined))
   throw new ImageRequestRejected(error.success?error.data.detail:'요청을 처리하지 못했어요. 입력을 확인해 주세요.')
  }
  if(!response.ok)throw new Error('접수 실패')
  return job.parse(await response.json())
 }
 private async get(path:string,signal?:AbortSignal) {
  const response=await protectedRequest(path,{signal},undefined,false,httpErrors)
  if(response.status===404)return null
  if(!response.ok)throw new Error('상태 조회 실패')
  return job.parse(await response.json())
 }
 readByKey(key:string,signal?:AbortSignal) { return this.get(`/api/v1/image-generations/by-request/${encodeURIComponent(key)}`,signal) }
 read(id:string,signal?:AbortSignal) { return this.get(`/api/v1/image-generations/${encodeURIComponent(id)}`,signal) }
 async image(id:string,signal?:AbortSignal) { return (await protectedRequest(`/api/v1/image-generations/${encodeURIComponent(id)}/content`,{signal})).blob() }
}
