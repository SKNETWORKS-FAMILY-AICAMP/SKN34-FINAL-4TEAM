import {z} from 'zod'
import type {Attachment,MediaTarget} from '../../domain/entities/media'
import type {MediaRepository} from '../../domain/repositories/MediaRepository'
import {assertAuthVersion,authVersion,protectedRequest} from '../api/auth'
import {csrf} from '../api/csrf'

const attachment=z.object({id:z.string().uuid(),filename:z.string().min(1).max(120),mediaType:z.string(),kind:z.enum(['IMAGE','FILE']),byteSize:z.number().int().positive().max(10485760),createdAt:z.string().datetime({offset:true}),url:z.string()})
function path(target:MediaTarget) {
 const base=`/api/v1/works/${encodeURIComponent(target.workId)}`
 return target.kind==='cover'?`${base}/cover`:target.kind==='setting'?`${base}/settings/${encodeURIComponent(target.settingId)}/attachments`:`${base}/episodes/${target.number}/images`
}
function contentPath(target:MediaTarget,id:string) {return `${path(target)}${target.kind==='cover'?'':`/${encodeURIComponent(id)}`}/content`}
export class HttpMediaRepository implements MediaRepository {
 private readonly fetcher?:typeof fetch
 constructor(fetcher?:typeof fetch){this.fetcher=fetcher}
 private async request(url:string,method='GET',body?:FormData,signal?:AbortSignal,publicView=false) {
  const version=authVersion()
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)
  const headers:Record<string,string>={}
  if(method!=='GET')headers['X-CSRF-TOKEN']=await csrf(requestSignal)
  const init={method,body,headers,signal:requestSignal,credentials:'same-origin' as const}
  const fetcher=this.fetcher??fetch
  const response=publicView?await fetcher(url,init):await protectedRequest(url,init,version,false,{fetcher,allowHttpError:true})
  if(!response.ok&&response.status!==404) {
   const error=z.object({detail:z.string()}).safeParse(await response.json().catch(()=>undefined))
   throw new Error(error.success?error.data.detail:'파일 요청을 처리하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.')
  }
  return response
 }
 private parse(target:MediaTarget,value:unknown):Attachment {
  const parsed=attachment.safeParse(value)
  if(!parsed.success||parsed.data.url!==contentPath(target,parsed.data.id))throw new Error('파일 서버 응답 형식을 확인할 수 없어요.')
  return parsed.data
 }
 async list(target:MediaTarget,signal?:AbortSignal) {
  const version=authVersion();const response=await this.request(path(target),'GET',undefined,signal)
  if(response.status===404&&target.kind==='cover')return []
  if(!response.ok)throw new Error('첨부를 찾을 수 없어요. 설정을 다시 선택해 주세요.')
  const value:unknown=await response.json();assertAuthVersion(version)
  const listed=z.object({attachments:z.array(z.unknown())}).safeParse(value)
  if(target.kind!=='cover'&&!listed.success)throw new Error('첨부 목록 응답 형식을 확인할 수 없어요.')
  const rows=target.kind==='cover'?[value]:listed.success?listed.data.attachments:[]
  return rows.map(item=>this.parse(target,item))
 }
 async upload(target:MediaTarget,file:File,replaceId?:string,signal?:AbortSignal) {
  const version=authVersion();const form=new FormData();form.append('file',file)
  const url=path(target)+(replaceId&&target.kind==='setting'?`/${encodeURIComponent(replaceId)}`:'')
  const response=await this.request(url,target.kind==='cover'||replaceId?'PUT':'POST',form,signal)
  if(!response.ok)throw new Error('첨부 대상을 찾을 수 없어요. 최신 설정을 불러와 주세요.')
  const value:unknown=await response.json();assertAuthVersion(version)
  return this.parse(target,value)
 }
 async remove(target:MediaTarget,id:string,signal?:AbortSignal) {
  const response=await this.request(path(target)+(target.kind==='cover'?'':`/${encodeURIComponent(id)}`),'DELETE',undefined,signal)
  if(response.status!==204)throw new Error('첨부를 삭제하지 못했어요. 새로고침 후 확인해 주세요.')
 }
 async download(target:MediaTarget,id:string,publicView=false,signal?:AbortSignal) {
  if(publicView&&target.kind==='setting')throw new Error('설정 첨부는 소유자만 조회할 수 있어요.')
  const version=authVersion();let url=contentPath(target,id)
  if(publicView)url=url.replace('/api/v1/works/','/api/v1/public/works/')
  const response=await this.request(url,'GET',undefined,signal,publicView)
  if(!response.ok)throw new Error('파일이 없거나 조회 권한이 없어요.')
  const blob=await response.blob();if(!publicView)assertAuthVersion(version)
  if(!blob.size||blob.size>10485760)throw new Error('파일 응답 크기를 확인할 수 없어요.')
  return blob
 }
}
