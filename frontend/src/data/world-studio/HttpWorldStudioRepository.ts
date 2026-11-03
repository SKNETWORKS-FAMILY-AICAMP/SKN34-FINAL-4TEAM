import { z } from 'zod'
import type { StudioWorld } from '../../domain/entities/studioWorld'
import type { WorldStudioRepository } from '../../domain/repositories/WorldStudioRepository'
const settingItemSchema=z.object({id:z.string(),kind:z.enum(['entity','fact','note']),category:z.enum(['basic','space','history','society','culture','special','conflict']).default('basic'),entityType:z.string().nullable().default(null),topics:z.array(z.string()).default([]),title:z.string(),text:z.string(),origin:z.literal('author_addition'),authorText:z.string(),decision:z.literal('approved')})

const schema=z.object({id:z.string(),name:z.string(),description:z.string(),version:z.number().int(),settings:z.array(z.object({item:settingItemSchema,userCategory:z.string(),tags:z.array(z.string())}))})
export class HttpWorldStudioRepository implements WorldStudioRepository {
 private readonly fetcher:typeof fetch
 constructor(fetcher:typeof fetch=fetch) {this.fetcher=fetcher.bind(globalThis)}
 private async request(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<unknown> {
  const res=await this.fetcher('/api/v1/studio'+path,{method,signal,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  const value:unknown=await res.json().catch(()=>{throw new Error('서버 응답을 읽지 못했습니다. 입력을 유지하고 연결·저장 상태를 확인해 주세요.')})
  if(!res.ok) {
   if(res.status===404 && path.startsWith('/worlds/'))throw new Error('이 환경에서 세계관을 찾을 수 없습니다. 세계관 작업실로 돌아가 목록에서 선택하거나 새로 만들어 주세요.')
   const detail=z.object({detail:z.string()}).safeParse(value)
   throw new Error(res.status===401?'작업실 연결이 필요해요. 체험 환경 안내를 열어 작업실 연결을 눌러 주세요.':detail.success?detail.data.detail:'요청에 실패했습니다. 입력을 유지하고 다시 열어 확인하세요.')
  }
  return value
 }
 async connect() {await this.request('/session','POST',{actor:'author'})}
 async listStudio(signal?:AbortSignal) {return z.array(schema).parse(await this.request('/worlds','GET',undefined,signal))}
 async read(id:string,signal?:AbortSignal) {return schema.parse(await this.request('/worlds/'+encodeURIComponent(id),'GET',undefined,signal))}
 async create(name:string,description:string) {return schema.parse(await this.request('/worlds','POST',{name,description}))}
 async saveStudio(w:StudioWorld) {return schema.parse(await this.request('/worlds/'+encodeURIComponent(w.id),'PUT',w))}
}
