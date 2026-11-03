import type {EpisodeRepository} from '../../domain/repositories/EpisodeRepository'
import { z } from 'zod'
import {settingCategories, type Draft, type SettingInput} from '../../domain/entities/content'

const draft = z.object({title:z.string(),body:z.string(),revision:z.number().int().nonnegative()})
const writing = z.object({number:z.number().int().positive(),draft,versions:z.array(draft.extend({id:z.string(),episode:z.number().int(),savedAt:z.string()})),publishedVersionId:z.string().nullable(),inherited:z.boolean(),updatedAt:z.string().nullable(),checkpointStatus:z.string()})
const episode = z.object({number:z.number().int().positive(),version:z.number().int().positive(),title:z.string(),body:z.string(),inherited:z.boolean()})
const source = z.object({workId:z.string(),title:z.string(),episode:z.number().int(),version:z.number().int(),direction:z.string()})
const work = z.object({id:z.string(),title:z.string(),summary:z.string(),visibility:z.enum(['private','public']),allowFork:z.boolean(),allowForkPublication:z.boolean().default(false),source:source.nullable(),episodes:z.array(episode),draft})
const setting = z.object({id:z.string(),versionId:z.string(),name:z.string(),content:z.string(),category:z.enum(settingCategories),tags:z.array(z.string()),visibility:z.enum(['private','public']),fromEpisode:z.number().int().positive(),toEpisode:z.number().int().positive().nullable(),knownBy:z.array(z.string()),evidence:z.string()})
const world = z.object({id:z.string(),name:z.string(),revision:z.number().int(),mode:z.enum(['own','following','independent']),basis:z.object({episode:z.number(),version:z.number(),settings:z.array(setting)}).nullable(),draft:setting.omit({versionId:true}).nullable(),settings:z.array(setting),drafts:z.array(setting.omit({versionId:true})).default([]),history:z.array(setting),sourceToken:z.string(),changes:z.array(z.object({id:z.string(),settingId:z.string(),before:setting.nullable(),after:setting.nullable(),decision:z.enum(['pending','apply','reject'])}))})
const context = z.object({title:z.string(),summary:z.string(),basisEpisode:z.number().int(),character:z.string(),settings:z.array(setting),draft:z.string(),episodes:z.array(z.object({number:z.number().int(),version:z.number().int(),versionId:z.string(),title:z.string(),sourceCharacters:z.number(),excerpts:z.array(z.object({start:z.number(),end:z.number(),text:z.string()}))})),selection:z.object({method:z.string(),omittedCharacters:z.number(),eligibleEpisodes:z.number(),note:z.string()})})
const proposal = z.object({id:z.string(),text:z.string().min(1),model:z.string(),revision:z.number().int(),status:z.enum(['pending','accepted']),prompt:z.string().optional(),baseBody:z.string().optional(),createdAt:z.string().optional(),context:context.optional()})

export class HttpEpisodeRepository implements EpisodeRepository {
  private readonly fetcher: typeof fetch
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher }
  private async request<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const fetcher = this.fetcher
    const response = await fetcher('/api/v1' + path, {method, headers: {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(80000)]) : AbortSignal.timeout(80000)})
    const value: unknown = await response.json()
    if (!response.ok) {
      const error = z.object({detail:z.string()}).safeParse(value)
      throw new Error(error.success ? error.data.detail : '요청을 처리하지 못했어요. 입력과 서버 상태를 확인해 주세요.')
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error('서버 응답 형식을 확인할 수 없어요.')
    return parsed.data
  }
  writingList(id:string,signal?:AbortSignal) {return this.request(`/works/${id}/episodes`,z.array(writing),'GET',undefined,signal)}
  createEpisode(id:string,title:string,signal?:AbortSignal) {return this.request(`/works/${id}/episodes`,writing,'POST',{title},signal)}
  writeEpisode(id:string,number:number,value:Draft,version:boolean,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/${version?'versions':'draft'}`,writing,version?'POST':'PUT',value,signal)}
  restoreEpisode(id:string,number:number,revision:number,versionId:string,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/restore`,writing,'POST',{revision,versionId},signal)}
  publishEpisode(id:string,number:number,revision:number,versionId:string,rightsConfirmed:boolean,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/publish`,writing,'POST',{revision,versionId,rightsConfirmed},signal)}
  async publicList(signal?: AbortSignal) {
    const rows = await this.request('/public/works', z.array(work.omit({draft:true})), 'GET', undefined, signal)
    return rows.map(w=>({...w,readOnly:true,draft:{title:'',body:'',revision:0}}))
  }
  list(signal?: AbortSignal) { return this.request('/works', z.array(work), 'GET', undefined, signal) }
  create(title: string, summary: string) { return this.request('/works',work,'POST',{title,summary}) }
  save(id: string, value: Draft) { return this.request(`/works/${id}/draft`,draft,'PUT',value) }
  publish(id: string, revision: number, rightsConfirmed: boolean, allowFork: boolean, allowForkPublication = false, versionId?: string) { return this.request(`/works/${id}/publish`,work,'POST',{revision,rightsConfirmed,allowFork,allowForkPublication,versionId}) }
  history(id: string) { return this.request(`/works/${id}/history`,z.object({versions:z.array(draft.extend({id:z.string(),episode:z.number().int(),savedAt:z.string()})),proposals:z.array(proposal)})) }
  policy(id: string, revision: number, allowFork: boolean, allowForkPublication: boolean) { return this.request(`/works/${id}/policy`,work,'PUT',{revision,allowFork,allowForkPublication}) }
  fork(id: string, episode: number, title: string, direction: string) { return this.request(`/works/${id}/forks`,work,'POST',{episode,title,direction}) }
  propose(id: string, revision: number, prompt: string, consent: boolean, signal?: AbortSignal, episode?:number, character='') { return this.request(`/works/${id}/proposals`,proposal,'POST',{revision,prompt,consent,episode,character},signal) }
  accept(id: string, pid: string, revision: number) { return this.request(`/works/${id}/proposals/${pid}/accept`,draft,'POST',{revision}) }
  world(id:string) {return this.request(`/works/${id}/world`,world)}
  saveSetting(id:string,sid:string,revision:number,value:SettingInput,sourceToken:string) {return this.request(`/works/${id}/settings/${sid}/draft`,world,'PUT',{revision,setting:value,sourceToken})}
  commitSetting(id:string,sid:string,revision:number) {return this.request(`/works/${id}/settings/${sid}/commit`,world,'POST',{revision})}
  revertSetting(id:string,sid:string,revision:number,versionId:string) {return this.request(`/works/${id}/settings/${sid}/revert`,world,'POST',{revision,versionId})}
  decideChange(id:string,revision:number,changeId:string,decision:'apply'|'reject') {return this.request(`/works/${id}/world/changes`,world,'POST',{revision,changeId,decision})}
  context(id:string,episode:number,query:string,character:string,publicView:boolean) {return this.request(`${publicView?'/public':''}/works/${id}/context?${new URLSearchParams({episode:String(episode),query,character})}`,context)}
}
