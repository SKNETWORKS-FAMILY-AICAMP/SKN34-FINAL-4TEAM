import type {EpisodeRepository} from '../../domain/repositories/EpisodeRepository'
import type {WorkRankingQuery, WorkSearchQuery, WorkSearchRepository} from '../../domain/repositories/WorkSearchRepository'
import { z } from 'zod'
import {settingCategories, type Draft, type SettingInput, type WorkRegistration} from '../../domain/entities/content'
import type { PublicationScheduleInput, PublicationScheduleRevision } from '../../domain/entities/publicationSchedule'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import { authVersion, getAccessToken, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'
import { mapReadingWork } from './readingWork'
import type { EpisodeWorldBasisChoice } from '../../domain/entities/episodeWorldBasis'

const draft = z.object({title:z.string(),body:z.string(),authorNote:z.string().optional(),revision:z.number().int().nonnegative()})
const writing = z.object({publicationStatus:z.enum(['draft','published','suspended']).optional(),hasDraft:z.boolean().optional(),number:z.number().int().positive(),draft,versions:z.array(draft.extend({id:z.string(),episode:z.number().int(),savedAt:z.string()})),publishedVersionId:z.string().nullable(),inherited:z.boolean(),updatedAt:z.string().nullable(),checkpointStatus:z.string(),checkpoints:z.array(z.object({versionId:z.string(),publishedAt:z.string(),active:z.boolean()}))})
const episode = z.object({number:z.number().int().positive(),version:z.number().int().positive(),versionId:z.string().optional(),title:z.string(),body:z.string(),authorNote:z.string().optional(),inherited:z.boolean()})
const source = z.object({workId:z.string(),title:z.string(),episode:z.number().int(),version:z.number().int(),direction:z.string(),deleted:z.boolean().optional()})
const work = z.object({revision:z.number().int().nonnegative(),writingEpisodeNumber:z.number().int().positive().nullable().optional(),creationType:z.enum(['ORIGINAL','EXTERNAL_DERIVATIVE']).optional(),genres:z.array(z.string()).optional(),hashtags:z.array(z.string()).optional(),hasWritingEpisode:z.boolean().optional(),id:z.string(),title:z.string(),summary:z.string(),visibility:z.enum(['private','public']),allowFork:z.boolean(),allowForkPublication:z.boolean().default(false),source:source.nullable(),episodes:z.array(episode),draft})
const setting = z.object({id:z.string(),versionId:z.string(),name:z.string(),content:z.string(),category:z.enum(settingCategories),tags:z.array(z.string()),visibility:z.enum(['private','public']),fromEpisode:z.number().int().positive(),toEpisode:z.number().int().positive().nullable(),knownBy:z.array(z.string()),evidence:z.string()})
const worldCheckpointSummary = z.object({ id: z.string().min(1), createdAt: z.iso.datetime() })
const worldCheckpoint = worldCheckpointSummary.extend({ settings: z.array(setting) })
const worldCheckpointsPath = (id: string) => `/works/${encodeURIComponent(id)}/world/checkpoints`
const world = z.object({id:z.string(),name:z.string(),revision:z.number().int(),mode:z.enum(['own','following','independent']),basis:z.object({episode:z.number(),version:z.number(),settings:z.array(setting)}).nullable(),draft:setting.omit({versionId:true}).nullable(),settings:z.array(setting),drafts:z.array(setting.omit({versionId:true})).default([]),history:z.array(setting),sourceToken:z.string(),changes:z.array(z.object({id:z.string(),settingId:z.string(),before:setting.nullable(),after:setting.nullable(),decision:z.enum(['pending','apply','reject'])}))})
const context = z.object({title:z.string(),summary:z.string(),basisEpisode:z.number().int(),character:z.string(),settings:z.array(setting),draft:z.string(),episodes:z.array(z.object({number:z.number().int(),version:z.number().int(),versionId:z.string(),title:z.string(),sourceCharacters:z.number(),excerpts:z.array(z.object({start:z.number(),end:z.number(),text:z.string()}))})),selection:z.object({method:z.string(),omittedCharacters:z.number(),eligibleEpisodes:z.number(),note:z.string()})})
const proposal = z.object({id:z.string(),text:z.string().min(1),model:z.string(),revision:z.number().int(),status:z.enum(['pending','accepted']),prompt:z.string().optional(),baseBody:z.string().optional(),createdAt:z.string().optional(),context:context.optional()})
const worldBasisId = z.object({ worldId: z.uuid(), revisionId: z.uuid() })
const worldBasisVersion = worldBasisId.extend({ revisionNo: z.number().int().positive(), name: z.string(), createdAt: z.iso.datetime() })
const worldBasisDetail = worldBasisId.extend({ cards: z.array(z.object({
  card: z.object({ id: z.uuid(), title: z.string(), body: z.string(), lifecycle: z.enum(['active', 'removed']) }),
})) })
const episodeBasis = z.object({ revision: z.number().int().nonnegative(), basis: worldBasisVersion.nullable() })
const episodeBasisPath = (id: string, number: number) => `/works/${encodeURIComponent(id)}/episodes/${number}/world-basis`
const worldRevisionsPath = (id: string) => `/world-studios/${encodeURIComponent(id)}/revisions`

const readingWork = work.omit({draft:true}).extend({
  slug:z.string().nullable(),authorName:z.string(),ownerId:z.string().min(1),revision:z.number().int().nonnegative(),
  theme:z.enum(['hanji','star','neon']),hook:z.string(),hanja:z.string().nullable(),hero:z.tuple([z.string(),z.string()]).nullable(),heroBg:z.string().nullable(),
  forkableEpisodes:z.array(z.number().int().positive()),episodes:z.array(episode.extend({versionId:z.string()})),
  /** 최근 24시간 조회 수(서버 값). 공개 목록·검색·랭킹 응답에서만 채워지고 그 밖에는 0이다. */
  views:z.number().int().nonnegative(),
  /** 공개 좋아요 수(서버 값). 공개 목록·검색·랭킹 응답에서만 채워지고 소유자 응답에서는 0이다. */
  likes:z.number().int().nonnegative(),
})
const instant = z.iso.datetime({offset:true})
/** 기간별 랭킹 응답: items는 공개 작품(방금 업데이트만 updatedAt=마지막 발행 시각)이고 computedAt은 서버가 계산한 시각이다. kind·period·type echo는 쓰지 않는다. */
const rankingsResponse = z.object({items:z.array(readingWork.extend({updatedAt:instant.nullable().optional()})),computedAt:instant})
const readingDocument = z.object({id:z.string(),versionId:z.string(),category:z.string(),name:z.string(),body:z.string(),
  aliases:z.array(z.string()),tags:z.array(z.string()),properties:z.array(z.object({name:z.string(),value:z.string()})),
  color:z.string(),image:z.string().nullable(),episode:z.number().int().nullable(),line:z.string().nullable(),participants:z.array(z.string()),
  knowledge:z.array(z.object({text:z.string(),knownAt:z.number().int(),publicAt:z.number().int()})),links:z.array(z.object({to:z.string(),kind:z.string()})),
})
const readingWorld = z.object({workId:z.string(),episode:z.number().int().positive(),documents:z.array(readingDocument)})
const publicationSchedule = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  scheduledAt: z.iso.datetime(),
  status: z.enum(['pending', 'published', 'failed', 'canceled']),
  revision: z.number().int().nonnegative(),
  completedAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
})
const schedulesPath = (id: string, number: number) => `/works/${encodeURIComponent(id)}/episodes/${number}/publication-schedules`
export type ReadingWorkRecord = z.infer<typeof readingWork>
export type ReadingWorldRecord = z.infer<typeof readingWorld>

export class HttpEpisodeRepository implements EpisodeRepository, WorkSearchRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  /** anonymous면 Bearer 없이 보낸다. 기본은 공개 목록·세계관 같은 /public/works 읽기이고, 회차 댓글은 로그인 상태면 Bearer로 읽어 mine·liked를 받는다. */
  async request<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown, signal?: AbortSignal, anonymous = path.startsWith('/public/works') && method === 'GET'): Promise<T> {
    const fetcher = this.fetcher ?? fetch
    const version = authVersion()
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(80000)]) : AbortSignal.timeout(80000)
    const headers: Record<string, string> = {'Content-Type':'application/json'}
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-CSRF-TOKEN'] = await csrf(requestSignal)
    const init = {method, headers, credentials: 'same-origin' as const, body:body === undefined ? undefined : JSON.stringify(body), signal:requestSignal}
    let response: Response
    try {
      response = anonymous
        ? await fetcher('/api/v1' + path, init)
        : await protectedRequest('/api/v1' + path, init, version, false, { fetcher, allowHttpError: true })
    } catch (error) {
      if (error instanceof SessionExpired) throw new SessionExpired('서버 인증이 필요합니다. 로그인한 뒤 다시 시도해 주세요.')
      throw error
    }
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = z.object({detail:z.string()}).safeParse(value)
      throw new Error(error.success ? error.data.detail : '요청을 처리하지 못했어요. 입력과 서버 상태를 확인해 주세요.')
    }
    if(method==='DELETE' && response.status!==204) throw new Error('삭제 완료 응답을 확인할 수 없어요. 다시 불러와 상태를 확인해 주세요.')
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error('서버 응답 형식을 확인할 수 없어요.')
    return parsed.data
  }
  orderScope(id:string,number:number,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/order-scope`,z.object({number:z.number().int(),candidateNumbers:z.array(z.number().int()),reasons:z.array(z.string()),executable:z.literal(false)}),'GET',undefined,signal)}
  deleteDraft(id:string,number:number,revision:number,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/draft?revision=${revision}`,z.undefined(),'DELETE',undefined,signal)}
  deleteEpisode(id:string,number:number,revision:number,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}?revision=${revision}`,z.undefined(),'DELETE',undefined,signal)}
  writingList(id:string,signal?:AbortSignal) {return this.request(`/works/${id}/episodes`,z.array(writing),'GET',undefined,signal)}
  createEpisode(id:string,title:string,signal?:AbortSignal) {return this.request(`/works/${id}/episodes`,writing,'POST',{title},signal)}
  writeEpisode(id:string,number:number,value:Draft,version:boolean,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/${version?'versions':'draft'}`,writing,version?'POST':'PUT',value,signal)}
  restoreEpisode(id:string,number:number,revision:number,versionId:string,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/restore`,writing,'POST',{revision,versionId},signal)}
  publishEpisode(id:string,number:number,revision:number,versionId:string,rightsConfirmed:boolean,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/publish`,writing,'POST',{revision,versionId,rightsConfirmed},signal)}
  publicationSchedules(id: string, number: number, signal?: AbortSignal) {
    return this.request(schedulesPath(id, number), z.array(publicationSchedule), 'GET', undefined, signal)
  }
  savePublicationSchedule(id: string, number: number, input: PublicationScheduleInput, target?: PublicationScheduleRevision, signal?: AbortSignal) {
    const path = schedulesPath(id, number)
    return target
      ? this.request(`${path}/${encodeURIComponent(target.id)}`, publicationSchedule, 'PUT', { ...input, revision: target.revision }, signal)
      : this.request(path, publicationSchedule, 'POST', input, signal)
  }
  cancelPublicationSchedule(id: string, number: number, target: PublicationScheduleRevision, signal?: AbortSignal) {
    return this.request(`${schedulesPath(id, number)}/${encodeURIComponent(target.id)}?revision=${target.revision}`, z.undefined(), 'DELETE', undefined, signal)
  }
  async publicList(signal?: AbortSignal) {
    const rows = await this.request('/public/works', z.array(work.omit({draft:true})), 'GET', undefined, signal)
    return rows.map(w=>({...w,readOnly:true,draft:{title:'',body:'',revision:0}}))
  }
  readingList(owned = false, signal?: AbortSignal) { return this.request(owned ? '/works' : '/public/works',z.array(readingWork),'GET',undefined,signal) }
  readingWorld(id:string,episode:number,signal?:AbortSignal) { return this.request(`/public/works/${encodeURIComponent(id)}/world?episode=${episode}`,readingWorld,'GET',undefined,signal) }
  async search(query: WorkSearchQuery, signal?: AbortSignal) {
    const params = new URLSearchParams({ f: query.f, sort: query.sort })
    if (query.q) params.set('q', query.q)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.size !== undefined) params.set('size', String(query.size))
    return (await this.request(`/public/works?${params}`, z.array(readingWork), 'GET', undefined, signal)).map((w) => mapReadingWork(w))
  }
  /** Work.upd는 마지막 업데이트 후 지난 분이라, updatedAt은 서버 계산 시각(computedAt) 기준으로 바꾼다(브라우저 시계와 무관). */
  async rankings(query: WorkRankingQuery, signal?: AbortSignal) {
    const params = new URLSearchParams({ kind: query.kind })
    for (const key of ['period', 'type', 'limit'] as const) if (query[key] != null) params.set(key, String(query[key]))
    const { items, computedAt } = await this.request(`/public/works/rankings?${params}`, rankingsResponse, 'GET', undefined, signal)
    const at = new Date(computedAt)
    const minutesSince = (updatedAt: string) => Math.max(0, Math.floor((at.getTime() - Date.parse(updatedAt)) / 60000))
    return { computedAt: at, items: items.map((w) => ({ ...mapReadingWork(w), ...(w.updatedAt ? { upd: minutesSince(w.updatedAt) } : {}) })) }
  }
  async recordView(id: string, number: number, signal?: AbortSignal) {
    if (!getAccessToken()) return // 익명 열람은 회원 식별이 없어 기록하지 않는다.
    await this.request(`/works/${encodeURIComponent(id)}/episodes/${number}/views`, z.undefined(), 'POST', undefined, signal)
  }
  list(signal?: AbortSignal) { return this.request('/works', z.array(work), 'GET', undefined, signal) }
  create(title: string, summary: string, signal?: AbortSignal, registration?: WorkRegistration) { return this.request('/works',work,'POST',registration?{title,summary,...registration}:{title,summary},signal) }
  updateWork(id: string, title: string, summary: string, revision: number, signal?: AbortSignal) { return this.request(`/works/${id}`,work,'PUT',{title,summary,revision},signal) }
  stopForkPublication(id: string, signal?: AbortSignal) { return this.request(`/works/${id}/fork-publication`,z.undefined(),'DELETE',undefined,signal) }
  deleteWork(id: string, signal?: AbortSignal) { return this.request(`/works/${id}`,z.undefined(),'DELETE',undefined,signal) }
  save(id: string, value: Draft) { return this.request(`/works/${id}/draft`,draft,'PUT',value) }
  publish(id: string, revision: number, rightsConfirmed: boolean, allowFork: boolean, allowForkPublication = false, versionId?: string) { return this.request(`/works/${id}/publish`,work,'POST',{revision,rightsConfirmed,allowFork,allowForkPublication,versionId}) }
  history(id: string,signal?:AbortSignal) { return this.request(`/works/${id}/history`,z.object({versions:z.array(draft.extend({id:z.string(),episode:z.number().int(),savedAt:z.string()})),proposals:z.array(proposal),publicationHistory:z.array(z.object({episode:z.number().int().positive(),versionId:z.string(),publishedAt:z.string(),action:z.enum(['publish','replace','unpublish','republish'])})).optional()}),'GET',undefined,signal) }
  setPublicationVisibility(id:string,number:number,revision:number,visible:boolean,rightsConfirmed:boolean,signal?:AbortSignal) {return this.request(`/works/${id}/episodes/${number}/visibility`,writing,'PUT',{revision,visible,rightsConfirmed},signal)}
  policy(id: string, revision: number, allowFork: boolean, allowForkPublication: boolean) { return this.request(`/works/${id}/policy`,work,'PUT',{revision,allowFork,allowForkPublication}) }
  fork(id: string, episode: number, title: string, direction: string) { return this.request(`/works/${id}/forks`,work,'POST',{episode,title,direction}) }
  propose(id: string, revision: number, prompt: string, consent: boolean, signal?: AbortSignal, episode?:number, character='') { return this.request(`/works/${id}/proposals`,proposal,'POST',{revision,prompt,consent,episode,character},signal) }
  accept(id: string, pid: string, revision: number) { return this.request(`/works/${id}/proposals/${pid}/accept`,draft,'POST',{revision}) }
  world(id:string,signal?:AbortSignal) {return this.request(`/works/${id}/world`,world,'GET',undefined,signal)}
  createWorldCheckpoint(id: string, signal?: AbortSignal) {
    return this.request(worldCheckpointsPath(id), worldCheckpoint, 'POST', undefined, signal)
  }
  worldCheckpoints(id: string, signal?: AbortSignal) {
    return this.request(worldCheckpointsPath(id), z.array(worldCheckpointSummary), 'GET', undefined, signal)
  }
  worldCheckpoint(id: string, checkpointId: string, signal?: AbortSignal) {
    return this.request(`${worldCheckpointsPath(id)}/${encodeURIComponent(checkpointId)}`, worldCheckpoint, 'GET', undefined, signal)
  }
  saveSetting(id:string,sid:string,revision:number,value:SettingInput,sourceToken:string) {return this.request(`/works/${id}/settings/${sid}/draft`,world,'PUT',{revision,setting:value,sourceToken})}
  commitSetting(id:string,sid:string,revision:number) {return this.request(`/works/${id}/settings/${sid}/commit`,world,'POST',{revision})}
  revertSetting(id:string,sid:string,revision:number,versionId:string,signal?:AbortSignal) {return this.request(`/works/${id}/settings/${sid}/revert`,world,'POST',{revision,versionId},signal)}
  decideChange(id:string,revision:number,changeId:string,decision:'apply'|'reject') {return this.request(`/works/${id}/world/changes`,world,'POST',{revision,changeId,decision})}
  context(id:string,episode:number,query:string,character:string,publicView:boolean) {return this.request(`${publicView?'/public':''}/works/${id}/context?${new URLSearchParams({episode:String(episode),query,character})}`,context)}
  episodeWorldBasis(id: string, number: number, signal?: AbortSignal) {
    return this.request(episodeBasisPath(id, number), episodeBasis, 'GET', undefined, signal)
  }
  chooseEpisodeWorldBasis(id: string, number: number, choice: EpisodeWorldBasisChoice, signal?: AbortSignal) {
    return this.request(episodeBasisPath(id, number), episodeBasis, 'PUT', choice, signal)
  }
  worldBasisVersions(worldId: string, signal?: AbortSignal) {
    return this.request(worldRevisionsPath(worldId), z.array(worldBasisVersion), 'GET', undefined, signal)
  }
  async confirmWorldBasisVersion(worldId: string, expectedDraftRevision: number, key: string, signal?: AbortSignal) {
    return (await this.request(worldRevisionsPath(worldId), worldBasisId, 'POST', { expectedDraftRevision, key }, signal)).revisionId
  }
  async worldBasisCards(worldId: string, revisionId: string, signal?: AbortSignal) {
    const detail = await this.request(worldRevisionsPath(worldId) + '/' + encodeURIComponent(revisionId), worldBasisDetail, 'GET', undefined, signal)
    return detail.cards.flatMap(({ card }) => card.lifecycle === 'active' ? [{ id: card.id, title: card.title, body: card.body }] : [])
  }
}
