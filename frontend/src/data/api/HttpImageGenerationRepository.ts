import { z } from 'zod'
import type { ImageGenerationRepository, ImageRequest } from '../../domain/repositories/ImageGenerationRepository'
import { protectedRequest } from './auth'
import { csrf } from './csrf'
const job = z.object({jobId:z.uuid(),status:z.enum(['accepted','queued','running','succeeded','failed','interrupted']),stage:z.string(),previewUrl:z.string().nullable()})
export class HttpImageGenerationRepository implements ImageGenerationRepository {
 async submit(input:ImageRequest,key:string,signal?:AbortSignal) {
  const token=await csrf(signal)
  return job.parse(await (await protectedRequest('/api/v1/image-generations',{method:'POST',signal,
   headers:{'Content-Type':'application/json','X-CSRF-TOKEN':token,'Idempotency-Key':key},body:JSON.stringify(input)})).json())
 }
 async readByKey(key:string,signal?:AbortSignal) {
  const response=await protectedRequest(`/api/v1/image-generations/by-request/${encodeURIComponent(key)}`,{signal},undefined,false,{allowHttpError:true})
  if(response.status===404)return null
  if(!response.ok)throw new Error('상태 조회 실패')
  return job.parse(await response.json())
 }
 async read(id:string,signal?:AbortSignal) { return job.parse(await (await protectedRequest(`/api/v1/image-generations/${encodeURIComponent(id)}`,{signal})).json()) }
 async image(id:string,signal?:AbortSignal) { return (await protectedRequest(`/api/v1/image-generations/${encodeURIComponent(id)}/content`,{signal})).blob() }
}
