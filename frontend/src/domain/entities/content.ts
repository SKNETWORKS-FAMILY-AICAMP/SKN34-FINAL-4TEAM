export type Draft = { title: string; body: string; revision: number }
export type Episode = { number: number; version: number; title: string; body: string; inherited: boolean }
export type Source = { workId: string; title: string; episode: number; version: number; direction: string }
export type WorkCreationType = 'ORIGINAL' | 'EXTERNAL_DERIVATIVE'
/** 작품 등록 시 함께 보내는 유형·장르·해시태그·권리 확인이다. 장르 2개·해시태그 10개까지다. */
export type WorkRegistration = { creationType: WorkCreationType; genres: string[]; hashtags: string[]; rightsConfirmed: boolean }
/** 해시태그 입력을 쉼표로 나누고 앞뒤 공백·앞의 #·빈 값·중복을 뺀다('천재 주인공'처럼 태그 안 공백은 유지). 개수 검증은 EpisodeUseCase.create가 한다. */
export const parseHashtags = (raw: string) => [...new Set(raw.split(',').map((t) => t.trim().replace(/^#+/, '').trim()).filter(Boolean))]
/** 작품 유형·장르·해시태그를 '원작 · 판타지 · #회귀'처럼 한 줄로 만든다. 유형이 없으면 빈 문자열이다. */
export const workMetaLabel = (w: Pick<Work, 'creationType' | 'genres' | 'hashtags'>) => w.creationType
  ? [w.creationType === 'EXTERNAL_DERIVATIVE' ? '외부 2차 창작' : '원작', ...(w.genres ?? []), ...(w.hashtags ?? []).map((t) => '#' + t)].join(' · ')
  : ''
export type Work = {writingEpisodeNumber?:number|null; creationType?: WorkCreationType; genres?: string[]; hashtags?: string[]; hasWritingEpisode?: boolean; readOnly?: boolean; id: string; title: string; summary: string; visibility: 'private' | 'public'; allowFork: boolean; allowForkPublication: boolean; source: Source | null; episodes: Episode[]; draft: Draft }
export type Proposal = { id: string; text: string; model: string; revision: number; status: 'pending' | 'accepted'; prompt?: string; baseBody?: string; createdAt?: string; context?: StoryContext }
export const settingCategories = ['규칙','인물','장소','광물','상태','지식','관계'] as const
export type SettingInput = {name:string;content:string;category:typeof settingCategories[number];tags:string[];visibility:'private'|'public';fromEpisode:number;toEpisode:number|null;knownBy:string[];evidence:string}
export type SavedSetting = SettingInput & {id:string;versionId:string}
export type World = {id:string;name:string;revision:number;mode:'own'|'following'|'independent';basis:{episode:number;version:number;settings:SavedSetting[]}|null;draft:(SettingInput & {id:string})|null;settings:SavedSetting[];drafts:(SettingInput & {id:string})[];history:SavedSetting[];sourceToken:string;changes:{id:string;settingId:string;before:SavedSetting|null;after:SavedSetting|null;decision:'pending'|'apply'|'reject'}[]}
export type StoryContext = {title:string;summary:string;basisEpisode:number;character:string;settings:SavedSetting[];draft:string;episodes:{number:number;version:number;versionId:string;title:string;sourceCharacters:number;excerpts:{start:number;end:number;text:string}[]}[];selection:{method:string;omittedCharacters:number;eligibleEpisodes:number;note:string}}
export type Version = Draft & { id: string; episode: number; savedAt: string }
export type PublicationEvent = {episode:number;versionId:string;publishedAt:string;action:'publish'|'replace'|'unpublish'|'republish'}
export type History = { versions: Version[]; proposals: Proposal[]; publicationHistory?:PublicationEvent[] }

/** 회차 체크포인트(DEC-43)는 발행본이다. versionId는 저장 버전 id, active는 현재 독자 공개본이며 발행 시각 오름차순이다. */
export type EpisodeCheckpoint = {versionId:string;publishedAt:string;active:boolean}
export type WritingEpisode = {publicationStatus?:'draft'|'published'|'suspended';hasDraft?:boolean;number:number;draft:Draft;versions:Version[];publishedVersionId:string|null;inherited:boolean;updatedAt:string|null;checkpointStatus:string;checkpoints:EpisodeCheckpoint[]}

export type EpisodeOrderScope = {number:number;candidateNumbers:number[];reasons:string[];executable:false}
