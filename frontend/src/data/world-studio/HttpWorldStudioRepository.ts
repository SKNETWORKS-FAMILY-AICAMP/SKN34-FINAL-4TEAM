import { z } from 'zod'
import type { WorldStudioRepository } from '../../domain/repositories/WorldStudioRepository'
import { PUBLIC_WORLD_GENRES } from '../../domain/entities/publicWorld'
import { isEpisodeKey, storedCharacterDocs } from '../../domain/entities/characterDocs'
import { newSetting, type StudioSetting, type StudioWorld, type WorldPublication, type WorldPublicationInput } from '../../domain/entities/studioWorld'
import { cardTypeOf } from '../../domain/entities/studioCards'
import { relationDefinitions } from '../../domain/entities/studioRelations'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import { authVersion, authenticatedUserId, protectedRequest } from '../api/auth'
import { csrf, withLock } from '../api/csrf'

const uuid = z.uuid(), revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
// 세계관 단위 공개 설정. 서버가 이 필드를 주기 전 응답은 비공개·장르 미지정으로 읽는다.
const visibility = z.enum(['private', 'public']), genre = z.enum(PUBLIC_WORLD_GENRES).nullable()
const publicationResult = z.object({ worldId: uuid, visibility, genre, publishedAt: z.string().nullable(), listed: z.boolean() })
// 세계관 표지. 서버가 `hasCover`를 주기 전 응답은 표지 없음으로 읽는다.
const coverResult = z.object({ worldId: uuid, hasCover: z.literal(true) })
// 이 세계관에 연결된 내 소설 id(DEC-46 1:1 연결). 서버가 이 필드를 주기 전 응답은 미연결로 읽는다.
const linkedWorkId = z.string().nullable().default(null)
const area = z.enum(['basic', 'space', 'history', 'society', 'culture', 'special', 'conflict'])
const evidence = z.array(z.object({ sourceId: z.string(), quote: z.string() }))
const studio = z.object({
  userCategory: z.string(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()).optional(),
  item: z.object({
    semanticType:z.enum(['fact','relation','rule','event','conjecture','goal','plan']).optional(),
    id: uuid,
    kind: z.enum([
      'entity',
      'fact',
      'rule',
      'constraint',
      'claim',
      'relation',
      'undetermined',
      'event',
      'note',
    ]),
    title: z.string(),
    text: z.string(),
    category: area,
    topics: z.array(z.string()),
    entityType: z.string().nullable(),
    subjectId: uuid.nullable(),
    targetId: uuid.nullable(),
    predicate: z.string().nullable(),
    polarity: z.enum(['asserted', 'denied']),
    relatedIds: z.array(uuid),
    condition: z.string(),
    timeText: z.string(),
    afterId: uuid.nullable(),
    orderEvidence: evidence,
    evidence,
    origin: z.enum(['extraction', 'correction', 'author_addition', 'author_input']),
    authorText: z.string().nullable(),
    decision: z.enum(['pending', 'approved', 'rejected', 'held']),
  }),
})
const preprocessing = z.object({
  semanticType: z.enum(['fact','relation','rule','event','conjecture','goal','plan']),
  provenance: z.enum(['ai_extraction','author_revision']), analysisId: uuid, candidateId: uuid,
  decisionSequence: revision.positive(), basisDraftRevision: revision,
  evidence: z.array(z.object({sourceId:z.string(),start:revision,end:revision,quote:z.string(),quoteHash:z.string().regex(/^[a-f0-9]{64}$/)})),
  condition:z.string(),timeText:z.string(),polarity:z.enum(['asserted','denied']),
}).passthrough()
const partialStudio = z.object({ item: z.object({id:uuid,kind:z.literal('note'),subjectId:uuid.nullable(),relatedIds:z.array(uuid)}).strict() }).strict()
const metadata = z.union([
  z.object({studio,preprocessing:preprocessing.optional()}).passthrough(),
  z.object({studio:partialStudio,preprocessing}).passthrough(),
])
// 카드 semanticMetadata의 최상위 키(DEC-46): 독자 공개 시작 회차와 가져온 출처. 모양이 어긋난 값은 읽지 않는다.
const revealFromEpisode = z.number().int().min(1)
const importedFrom = z.object({ worldId: z.string(), worldName: z.string(), authorNickname: z.string(), revisionNo: z.number().int(), cardId: z.string() })
// 인물 문서(SOUL.md·MEMORY.md·회차별 기억)도 인물 카드 semanticMetadata의 최상위 키 `characterDocs`다. IDENTITY.md는 카드 본문(body)이라 여기 없다.
const characterDocs = z.object({ soul: z.string(), memory: z.string(), episodes: z.record(z.string().refine(isEpisodeKey), z.string()) })
// 카드 공개·독자 공개 회차·가져온 출처·인물 문서는 행 필드가 정본이라 `studio` 안에 넣지 않는다. 회차·출처·문서는 최상위 키로 쓰고 값이 없으면(문서는 전부 비었거나 인물이 아니면) 키도 넣지 않는다.
function metadataOf(row:StudioSetting) {
  const {serverMetadata,visibility:_,revealFromEpisode:reveal,importedFrom:source,characterDocs:_docs,...view}=row
  const docs=storedCharacterDocs(row)
  return {...serverMetadata,studio:view,...(reveal!==undefined&&{revealFromEpisode:reveal}),...(source&&{importedFrom:source}),...(docs&&{characterDocs:docs})}
}
// A 6-B addition is a wire card/relation, not a complete legacy StudioSetting.
function setting(m:z.infer<typeof metadata>, fields:Partial<StudioSetting['item']>, labels:Pick<StudioSetting,'userCategory'|'tags'|'aliases'>):StudioSetting {
  const full=studio.safeParse(m.studio)
  if(full.success)return Object.keys(m).some(key=>key!=='studio') ? {...full.data,serverMetadata:m} : full.data
  const p=m.preprocessing
  if(!p)throw invalid()
  const base=newSetting()
  return {...base,...labels,serverMetadata:m,item:{...base.item,...m.studio.item,
    kind:p.semanticType==='relation'?'relation':p.semanticType==='rule'?'rule':p.semanticType==='event'?'event':p.semanticType==='conjecture'?'claim':'fact',
    semanticType:p.semanticType,condition:p.condition,timeText:p.timeText,polarity:p.polarity,evidence:p.evidence,
    origin:p.provenance==='ai_extraction'?'extraction':'author_addition',authorText:null,...fields}}
}
const card = z.object({
  id: uuid,
  title: z.string(),
  body: z.string(),
  cardType: z.enum([
    'character',
    'location',
    'organization',
    'ability',
    'object',
    'rule',
    'event',
    'other',
  ]),
  areaCode: area,
  classification: z.string(),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  semanticMetadata: metadata,
  visibility,
  lifecycle: z.enum(['active', 'removed']),
})
const confirmationRequest=z.object({expectedDraftRevision:revision,key:uuid})
const revisionSummary=z.object({worldId:uuid,revisionId:uuid,revisionNo:revision.positive(),name:z.string(),createdAt:z.string()})
const revisionSnapshot=z.object({worldId:uuid,revisionId:uuid,revisionNo:revision.positive(),name:z.string(),description:z.string(),parentRevisionId:uuid.nullable(),restoredFromRevisionId:uuid.nullable(),relationshipStatus:z.literal('not_recorded'),relationships:z.null(),cards:z.array(z.object({versionId:uuid,versionNo:revision.positive(),restoredFromVersionId:uuid.nullable(),card:card.extend({semanticMetadata:z.record(z.string(),z.unknown()),visibility:z.enum(['private','public'])})}))})
const relation = z.object({
  id: uuid,
  sourceCardId: uuid.nullable(),
  targetCardId: uuid.nullable(),
  category: z.enum(['structural', 'emotional']).nullable(),
  body: z.string(),
  label: z.string(),
  direction: z.enum(['directed', 'symmetric']).nullable(),
  polarity: z.enum(['asserted', 'denied']).nullable(),
  semanticMetadata: metadata,
  lifecycle: z.literal('active'),
})
const draft = z.object({
  worldId: uuid,
  draftRevision: revision,
  currentRevisionId: uuid.nullable(),
  baseWorldRevisionId: uuid.nullable(),
  name: z.string(),
  description: z.string(),
  cards: z.array(card),
  relationships: z.array(relation),
  relationshipVersion: revision,
  relationshipStatus: z.literal('current'),
  visibility: visibility.default('private'),
  genre: genre.default(null),
  hasCover: z.boolean().default(false),
  linkedWorkId,
})
const summaries = z.array(
  z.object({
    worldId: uuid,
    name: z.string(),
    description: z.string(),
    draftRevision: revision,
    relationshipStatus: z.enum(['current', 'incomplete', 'migration_required']),
    visibility: visibility.default('private'),
    genre: genre.default(null),
    hasCover: z.boolean().default(false),
    linkedWorkId,
  }),
)
const invalid = () =>
  new Error(
    '서버 응답과 현재 관계 상태를 확인할 수 없어요. 입력을 보존하고 저장 상태를 확인해 주세요.',
  )
function cardType(row: StudioSetting) {
  const type = cardTypeOf(row.item)
  return ['note', 'review'].includes(type) ? 'other' : type
}
function relationship(row: StudioSetting) {
  const definition = relationDefinitions[row.item.predicate ?? '']
  if (definition?.group === 'other') {
    throw new Error('현재 관계 저장은 구조 관계와 감정만 지원합니다.')
  }
  return {
    id: row.item.id,
    sourceCardId: row.item.subjectId,
    targetCardId: row.item.targetId,
    category: definition ? definition.group === 'emotion' ? 'emotional' : 'structural' : null,
    direction: definition ? definition.symmetric ? 'symmetric' : 'directed' : null,
    polarity: row.item.polarity,
    body: row.item.text,
    label: row.item.title,
    semanticMetadata: metadataOf(row),
    lifecycle: 'active',
  }
}
function world(value: z.infer<typeof draft>, id: string): StudioWorld {
  if (value.worldId !== id) throw invalid()
  // 관계 끝점은 삭제한 카드도 이 세계관의 카드다: 지난 회차 시점 관계는 그 뒤에 삭제한 설정을 끝점으로 가질 수 있다(DEC-51).
  const active = value.cards.filter((c) => c.lifecycle === 'active'),
    ids = new Set(value.cards.map((c) => c.id))
  const settings: StudioSetting[] = active.map((c) => {
    // 독자 공개 회차·가져온 출처·인물 문서는 서버 메타데이터에 남기지 않고 행 필드로 옮긴다(지운 값이 다음 저장에서 되살아나지 않게). 어긋난 값은 버리고 읽기는 계속한다.
    const {revealFromEpisode:reveal,importedFrom:source,characterDocs:written,...known}=c.semanticMetadata
    const row = setting(known,{id:c.id,title:c.title,text:c.body,category:c.areaCode},
      {userCategory:c.classification,aliases:c.aliases,tags:c.tags})
    if(c.semanticMetadata.studio.item.id!==c.id)throw invalid()
    if (
      row.item.kind === 'relation' || row.item.id !== c.id || row.item.title !== c.title ||
      row.item.text !== c.body || row.item.category !== c.areaCode ||
      cardType(row) !== c.cardType || row.userCategory !== c.classification ||
      JSON.stringify(row.tags) !== JSON.stringify(c.tags) ||
      JSON.stringify(row.aliases ?? []) !== JSON.stringify(c.aliases)
    ) throw invalid()
    const episode = revealFromEpisode.safeParse(reveal), from = importedFrom.safeParse(source), docs = characterDocs.safeParse(written)
    return {...row,...(c.visibility==='public'&&{visibility:c.visibility}),...(episode.success&&{revealFromEpisode:episode.data}),...(from.success&&{importedFrom:from.data}),
      ...(docs.success&&c.cardType==='character'&&{characterDocs:docs.data})}
  })
  for (const r of value.relationships) {
    const row = setting(r.semanticMetadata,{id:r.id,kind:'relation',title:r.label,text:r.body,
      subjectId:r.sourceCardId,targetId:r.targetCardId,polarity:r.polarity??'asserted',
      predicate:r.category==='emotional'?(r.direction==='symmetric'?'preserved_emotion_symmetric':'custom_emotion'):r.direction==='symmetric'?'custom_relation':'custom_relation_directed'},
      {userCategory:'',tags:[],aliases:[]}), expected = relationship(row)
    if(r.semanticMetadata.studio.item.id!==r.id)throw invalid()
    if (
      row.item.kind !== 'relation' || row.item.id !== r.id || r.body !== expected.body ||
      r.label !== expected.label || r.sourceCardId !== expected.sourceCardId ||
      r.targetCardId !== expected.targetCardId || r.category !== expected.category ||
      r.direction !== expected.direction || r.polarity !== expected.polarity ||
      r.sourceCardId !== null && !ids.has(r.sourceCardId) ||
      r.targetCardId !== null && !ids.has(r.targetCardId)
    ) throw invalid()
    settings.push(row)
  }
  if (new Set(settings.map((s) => s.item.id)).size !== settings.length) throw invalid()
  return {
    id,
    currentRevisionId:value.currentRevisionId,
    name: value.name,
    description: value.description,
    version: value.draftRevision,
    visibility: value.visibility,
    genre: value.genre,
    hasCover: value.hasCover,
    linkedWorkId: value.linkedWorkId,
    settings,
    analysis: null,
  }
}

/** 관계는 회차 시점으로 읽고 쓴다(DEC-51). 재시도 입력은 이 탭의 메모리에만 보존하며 PG·브라우저 영구 저장소에 복제하지 않는다. */
export class HttpWorldStudioRepository implements WorldStudioRepository {
  readonly relationEpisodes = true as const
  private readonly fetcher?: typeof fetch
  private session = authVersion()
  private pendingCreate?: { id: string; name: string; description: string }
  private readonly pending = new Map<string, { input: string; body: string }>()
  constructor(fetcher?: typeof fetch) {
    this.fetcher = fetcher
  }
  private checkSession() {
    if (this.session !== authVersion()) {
      this.session = authVersion()
      this.pending.clear()
      this.pendingCreate = undefined
    }
  }
  /** 인증·CSRF·시간 제한을 붙여 보내고 응답은 그대로 돌려준다. multipart(FormData)는 Content-Type을 브라우저가 경계와 함께 붙이도록 두지 않는다. */
  private async send(path: string, method: string, body: string | FormData | undefined, signal: AbortSignal | undefined): Promise<Response> {
    const version = authVersion(),
      requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000)
    const headers: Record<string, string> = body instanceof FormData ? {} : { 'Content-Type': 'application/json' }
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(requestSignal)
    try {
      return await protectedRequest(
        '/api/v1/world-studios' + path,
        { method, body, headers, credentials: 'same-origin', signal: requestSignal },
        version,
        false,
        { fetcher: this.fetcher ?? fetch, allowHttpError: true },
      )
    } catch (error) {
      if (error instanceof SessionExpired) {
        throw new SessionExpired(
          '서버 로그인이 필요합니다. 입력을 보존하고 로그인한 뒤 다시 시도하세요.',
        )
      }
      throw error
    }
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    body?: string | FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.send(path, method, body, signal)
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const failure = z.object({ detail: z.string(), code: z.string().optional() }).safeParse(value)
      const rejected = failure.success &&
        (response.status===409&&path.endsWith('/revisions') || response.status === 422 && failure.data.code === 'WORLD_INPUT_INVALID' ||
          response.status === 409 && failure.data.code === 'WORLD_WRITE_REJECTED')
      throw new Error(
        failure.success
          ? failure.data.detail
          : '저장 상태를 확인하지 못했습니다. 입력을 보존하고 같은 요청으로 다시 시도하세요.',
        { cause: rejected ? 'WORLD_WRITE_REJECTED' : undefined },
      )
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw invalid()
    return parsed.data
  }
  private confirmationKey(id:string){uuid.parse(id);const owner=authenticatedUserId();if(!owner)throw new Error('로그인이 필요합니다.');return `storyfork:confirmation:${owner}:${id}`}
  pendingConfirmation(id:string){const raw=localStorage.getItem(this.confirmationKey(id));return raw?confirmationRequest.parse(JSON.parse(raw)):null}
  acknowledgeConfirmation(id:string){localStorage.removeItem(this.confirmationKey(id))}
  async revisions(id:string,signal?:AbortSignal){uuid.parse(id);const rows=await this.request('/'+id+'/revisions',z.array(revisionSummary),'GET',undefined,signal);if(rows.some(r=>r.worldId!==id))throw invalid();return rows}
  async revision(id:string,revisionId:string,signal?:AbortSignal){uuid.parse(id);uuid.parse(revisionId);const row=await this.request('/'+id+'/revisions/'+revisionId,revisionSnapshot,'GET',undefined,signal);if(row.worldId!==id||row.revisionId!==revisionId)throw invalid();return row}
  async confirm(id:string,expected:number,signal?:AbortSignal){
    const storageKey=this.confirmationKey(id)
    return withLock(storageKey,async()=>{
      const previous=this.pendingConfirmation(id)
      if(previous&&previous.expectedDraftRevision!==expected)throw new Error('확정 결과가 미확인입니다. 같은 입력으로 다시 확인하세요.')
      const body=previous??confirmationRequest.parse({expectedDraftRevision:expected,key:crypto.randomUUID()})
      localStorage.setItem(storageKey,JSON.stringify(body))
      try{const saved=await this.request('/'+id+'/revisions',revisionSnapshot,'POST',JSON.stringify(body),signal);if(saved.worldId!==id)throw invalid();return saved}
      catch(error){if(error instanceof Error&&error.cause==='WORLD_WRITE_REJECTED')localStorage.removeItem(storageKey);throw error}
    },true)
  }
  async listStudio(signal?: AbortSignal): Promise<StudioWorld[]> {
    this.checkSession()
    const rows = await this.request('', summaries, 'GET', undefined, signal)
    return rows.map((r) => ({
      id: r.worldId,
      name: r.name,
      description: r.description,
      version: r.draftRevision,
      visibility: r.visibility,
      genre: r.genre,
      hasCover: r.hasCover,
      linkedWorkId: r.linkedWorkId,
      settings: [],
      analysis: null,
      relationshipStatus: r.relationshipStatus,
    }))
  }
  async read(id: string, signal?: AbortSignal, episode?: number): Promise<StudioWorld> {
    this.checkSession()
    uuid.parse(id)
    const query = episode === undefined ? '' : '?episode=' + episode
    return world(await this.request('/' + id + query, draft, 'GET', undefined, signal), id)
  }
  /** 공개 범위·장르는 초안 저장과 별개로 바로 적용된다. 공개로 설정해도 확정 버전이 없으면 `listed`가 false다. */
  async setPublication(id: string, publication: WorldPublicationInput, signal?: AbortSignal): Promise<WorldPublication> {
    this.checkSession()
    uuid.parse(id)
    const body = JSON.stringify({ visibility: publication.visibility, genre: publication.genre })
    const result = await this.request('/' + id + '/publication', publicationResult, 'PUT', body, signal)
    if (result.worldId !== id) throw invalid()
    return result
  }
  /** 세계관 표지(소유자): 업로드·교체는 multipart `file` PUT, 삭제는 DELETE(204), 읽기는 이미지 바이트 GET이다. 형식·크기 오류(422)와 없는 세계관(404)은 서버의 detail을 그대로 알린다. */
  async setCover(id: string, file: File, signal?: AbortSignal): Promise<void> {
    this.checkSession()
    uuid.parse(id)
    const form = new FormData()
    form.append('file', file)
    const result = await this.request('/' + id + '/cover', coverResult, 'PUT', form, signal)
    if (result.worldId !== id) throw invalid()
  }
  async removeCover(id: string, signal?: AbortSignal): Promise<void> {
    this.checkSession()
    uuid.parse(id)
    await this.request('/' + id + '/cover', z.undefined(), 'DELETE', undefined, signal)
  }
  async readCover(id: string, signal?: AbortSignal): Promise<Blob> {
    this.checkSession()
    uuid.parse(id)
    const response = await this.send('/' + id + '/cover', 'GET', undefined, signal)
    if (!response.ok) throw new Error(response.status === 404 ? '표지를 찾을 수 없어요.' : '표지를 불러오지 못했어요.')
    const blob = await response.blob()
    if (!blob.size) throw new Error('표지 이미지 응답을 확인할 수 없어요.')
    return blob
  }
  async create(name: string, description: string, signal?: AbortSignal): Promise<StudioWorld> {
    this.checkSession()
    if (
      this.pendingCreate &&
      (this.pendingCreate.name !== name || this.pendingCreate.description !== description)
    ) throw new Error('생성 완료가 미확인입니다. 같은 입력으로 생성 요청을 다시 시도하세요.')
    const body = this.pendingCreate ?? { id: crypto.randomUUID(), name, description }
    this.pendingCreate = body
    try {
      const saved = world(
        await this.request('', draft, 'POST', JSON.stringify(body), signal),
        body.id,
      )
      this.pendingCreate = undefined
      return saved
    } catch (error) {
      if (error instanceof Error && error.cause === 'WORLD_WRITE_REJECTED') {
        this.pendingCreate = undefined
      }
      throw error
    }
  }
  async saveStudio(value: StudioWorld, signal?: AbortSignal, episode?: number): Promise<StudioWorld> {
    this.checkSession()
    uuid.parse(value.id)
    // 회차도 같은 입력의 일부다: 미확인 저장을 다른 회차로 바꿔 덮어쓰지 않는다(undefined는 직렬화에서 빠져 회차 없는 입력은 그대로다).
    const input = JSON.stringify({
      id: value.id,
      name: value.name,
      description: value.description,
      version: value.version,
      settings: value.settings,
      episode,
    })
    const previous = this.pending.get(value.id)
    if (previous && previous.input !== input) {
      throw new Error(
        '저장 완료가 미확인입니다. 먼저 같은 입력으로 다시 저장하세요. 변경된 입력으로 미완료 요청을 덮어쓰지 않습니다.',
      )
    }
    const body = previous?.body ??
      JSON.stringify({
        expectedDraftRevision: value.version,
        key: crypto.randomUUID(),
        replace: true,
        ...(episode !== undefined && { episode }),
        name: value.name,
        description: value.description,
        cards: value.settings.filter((s) => s.item.kind !== 'relation').map((row) => ({
          id: row.item.id,
          title: row.item.title,
          body: row.item.text,
          cardType: cardType(row),
          areaCode: row.item.category,
          classification: row.userCategory,
          aliases: row.aliases ?? [],
          tags: row.tags,
          semanticMetadata: metadataOf(row),
          visibility: row.visibility ?? 'private',
          lifecycle: 'active',
        })),
        relationships: value.settings.filter((s) => s.item.kind === 'relation').map(relationship),
      })
    this.pending.set(value.id, { input, body })
    try {
      const saved = world(
        await this.request('/' + value.id + '/draft', draft, 'PUT', body, signal),
        value.id,
      )
      if (saved.version !== value.version + 1) throw invalid()
      this.pending.delete(value.id)
      return saved
    } catch (error) {
      if (error instanceof Error && error.cause === 'WORLD_WRITE_REJECTED') {
        this.pending.delete(value.id)
      }
      throw error
    }
  }
}
