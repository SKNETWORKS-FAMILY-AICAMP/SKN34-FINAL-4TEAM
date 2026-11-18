export type Draft = { title: string; body: string; authorNote?: string; revision: number }
export type Episode = { number: number; version: number; /** 공개 중인 저장 버전 id. 같은 회차의 `WritingEpisode.versions`에서 찾아 '저장 버전 N'으로 보인다(`version`은 초안 편집 번호다). */ versionId?: string; title: string; body: string; authorNote?: string; inherited: boolean }
export type Source = { workId: string; title: string; episode: number; version: number; direction: string; deleted?: boolean }
export type WorkCreationType = 'ORIGINAL' | 'EXTERNAL_DERIVATIVE'
/** 작품 등록 시 함께 보내는 유형·장르·해시태그·권리 확인이다. 장르 2개·해시태그 10개까지다. */
export type WorkRegistration = { creationType: WorkCreationType; genres: string[]; hashtags: string[]; rightsConfirmed: boolean }
/** 작품 정보 수정에 함께 보내는 장르·해시태그다. 주지 않은 쪽은 서버가 그대로 두고, 빈 배열은 비우기다. 규칙은 등록과 같다. */
export type WorkTaxonomy = Partial<Pick<WorkRegistration, 'genres' | 'hashtags'>>
/** 장르·해시태그 AI 추천 후보(#372). 저장하지 않으며 작가가 고른 값만 작품 정보 수정으로 저장한다. */
export type WorkTagSuggestion = { genres: string[]; hashtags: string[] }
/** 추천 장르 후보를 입력에 담을 수 있는지: 아직 고르지 않았고 두 칸 중 빈 칸이 있을 때다. */
export const canPickSuggestedGenre = (picked: [string, string], genre: string) => !picked.includes(genre) && picked.some((g) => !g)
/** 추천 해시태그 후보를 더할 수 있는지: 아직 없고 10개 미만일 때다. */
export const canAddSuggestedTag = (tags: string[], tag: string) => !tags.includes(tag) && tags.length < 10
/** 해시태그 입력을 쉼표로 나누고 앞뒤 공백·앞의 #·빈 값·중복을 뺀다('천재 주인공'처럼 태그 안 공백은 유지). 개수 검증은 EpisodeUseCase가 한다. */
export const parseHashtags = (raw: string) => [...new Set(raw.split(',').map((t) => t.trim().replace(/^#+/, '').trim()).filter(Boolean))]
/** 히어로 칩에 쓰는 작품 종류다. 분기 작품은 서버가 유형을 ORIGINAL로 내려 줘도 '분기 작품'이고, 유형이 없으면 빈 문자열이다. */
export const workKindLabel = (w: Pick<Work, 'creationType' | 'source'>) =>
  w.source ? '분기 작품' : w.creationType === 'EXTERNAL_DERIVATIVE' ? '외부 2차 창작' : w.creationType ? '원작' : ''
export type Work = {revision:number; creationType?: WorkCreationType; genres?: string[]; hashtags?: string[]; readOnly?: boolean; id: string; title: string; summary: string; visibility: 'private' | 'public'; allowFork: boolean; allowForkPublication: boolean; source: Source | null; episodes: Episode[]; draft: Draft; /** 연결된 WorldStudio 세계관 id(DEC-46 1:1 연결). 소유자 응답에서만 오고 없으면 미연결이다. */ worldStudioId?: string | null }
export type Proposal = { id: string; text: string; model: string; revision: number; status: 'pending' | 'accepted'; prompt?: string; baseBody?: string; createdAt?: string; context?: StoryContext }
export const settingCategories = ['규칙','인물','장소','광물','상태','지식','관계'] as const
export type SettingInput = {name:string;content:string;category:typeof settingCategories[number];tags:string[];visibility:'private'|'public';fromEpisode:number;toEpisode:number|null;knownBy:string[];evidence:string}
export type SavedSetting = SettingInput & {id:string;versionId:string}
export type WorldCheckpointSummary = { id: string; createdAt: string }
export type WorldCheckpoint = WorldCheckpointSummary & { settings: SavedSetting[] }
export type World = {id:string;name:string;revision:number;mode:'own'|'following'|'independent';basis:{episode:number;version:number;settings:SavedSetting[]}|null;draft:(SettingInput & {id:string})|null;settings:SavedSetting[];drafts:(SettingInput & {id:string})[];history:SavedSetting[];sourceToken:string;changes:{id:string;settingId:string;before:SavedSetting|null;after:SavedSetting|null;decision:'pending'|'apply'|'reject'}[]}
export type StoryContext = {title:string;summary:string;basisEpisode:number;character:string;settings:SavedSetting[];draft:string;episodes:{number:number;version:number;versionId:string;title:string;sourceCharacters:number;excerpts:{start:number;end:number;text:string}[]}[];selection:{method:string;omittedCharacters:number;eligibleEpisodes:number;note:string}}

type QaEpisodeRef = { number: number; versionId: string }
export type StoryQaTarget = 'manuscript' | 'setting' | 'relationship'
export type StoryQaInput = { episode: number; episodeVersionId: string; question: string; consent: boolean; target: StoryQaTarget }
type StoryQaSource = { id: string; workId: string; sourceWorkId: string | null; episode: number; quote: string } & (
  | { kind: 'manuscript'; episodeId: string; versionId: string; startUtf16: number; endUtf16: number }
  | { kind: 'setting'; settingId: string; versionId: string; title: string }
  | { kind: 'relationship'; worldId: string; graphVersion: number; relationshipId: string; title: string }
)
export type ManuscriptQaAnswer = {
  status: 'answered' | 'partial' | 'insufficient'
  claims: { text: string; kind: 'confirmed' | 'inferred'; sourceIds: string[] }[]
  sources: StoryQaSource[]
  gaps: { code: string; detail: string }[]
  coverage: { expected: QaEpisodeRef[]; withVerifiedExcerpt: QaEpisodeRef[]; withoutVerifiedExcerpt: QaEpisodeRef[] }
}
export type Version = Draft & { id: string; episode: number; savedAt: string }
export type PublicationEvent = {episode:number;versionId:string;publishedAt:string;action:'publish'|'replace'|'unpublish'|'republish'}
export const publicationActionLabel:Record<PublicationEvent['action'],string>={publish:'발행',replace:'발행본 교체',unpublish:'공개 중단',republish:'재공개'}
export type History = { versions: Version[]; proposals: Proposal[]; publicationHistory?:PublicationEvent[] }

/** 회차 체크포인트(DEC-43)는 발행본이다. versionId는 저장 버전 id, active는 현재 독자 공개본이며 발행 시각 오름차순이다. */
export type EpisodeCheckpoint = {versionId:string;publishedAt:string;active:boolean}
export type WritingEpisode = {publicationStatus?:'draft'|'published'|'suspended';hasDraft?:boolean;number:number;draft:Draft;versions:Version[];publishedVersionId:string|null;inherited:boolean;updatedAt:string|null;checkpointStatus:string;checkpoints:EpisodeCheckpoint[]}

/** Fork가 자기 세계관 없이 이어받는 원작 세계관의 카드(읽기 전용, #365). 서버가 공개 카드·Fork 기준 회차로 이미 거른 값이며 시뮬레이션 시작 양식의 인물 후보로 쓴다. */
export type InheritedCard = { id: string; title: string; cardType: string; aliases: string[] }
/** 이어받은 세계관에서 「동일 인물」로 이은 카드 쌍(다른 이름 카드 → 본체 카드, 부정 제외). 시작 양식이 같은 사람의 두 카드를 함께 고르지 못하게 하는 데 쓴다(#485). */
export type InheritedIdentity = { sourceCardId: string; targetCardId: string }
export type InheritedWorld = { upto: number; cards: InheritedCard[]; identity?: InheritedIdentity[] }
export type EpisodeOrderScope = {number:number;candidateNumbers:number[];reasons:string[];executable:false}

/** 집필실이 표시하는 회차별 저장 순번. 발행본의 편집 revision과 구분한다. id가 없거나 목록에 없으면 번호를 지어내지 않는다. */
export function savedVersionLabel(versions: readonly {id: string}[], id?: string) {
  const index = versions.findIndex(version => version.id === id)
  return index < 0 ? '저장 버전 미확인' : `저장 버전 ${index + 1}`
}
