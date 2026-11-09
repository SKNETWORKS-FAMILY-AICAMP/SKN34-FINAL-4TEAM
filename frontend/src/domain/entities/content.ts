export type Draft = { title: string; body: string; revision: number }
export type Episode = { number: number; version: number; title: string; body: string; inherited: boolean }
export type Source = { workId: string; title: string; episode: number; version: number; direction: string }
export type WorkCreationType = 'ORIGINAL' | 'EXTERNAL_DERIVATIVE'
/** 작품 등록 시 함께 보내는 유형·장르·해시태그·권리 확인이다. 장르 2개·해시태그 10개까지다. */
export type WorkRegistration = { creationType: WorkCreationType; genres: string[]; hashtags: string[]; rightsConfirmed: boolean }
export type Work = { creationType?: WorkCreationType; genres?: string[]; hashtags?: string[]; hasWritingEpisode?: boolean; readOnly?: boolean; id: string; title: string; summary: string; visibility: 'private' | 'public'; allowFork: boolean; allowForkPublication: boolean; source: Source | null; episodes: Episode[]; draft: Draft }
export type Proposal = { id: string; text: string; model: string; revision: number; status: 'pending' | 'accepted'; prompt?: string; baseBody?: string; createdAt?: string; context?: StoryContext }
export const settingCategories = ['규칙','인물','장소','광물','상태','지식','관계'] as const
export type SettingInput = {name:string;content:string;category:typeof settingCategories[number];tags:string[];visibility:'private'|'public';fromEpisode:number;toEpisode:number|null;knownBy:string[];evidence:string}
export type SavedSetting = SettingInput & {id:string;versionId:string}
export type World = {id:string;name:string;revision:number;mode:'own'|'following'|'independent';basis:{episode:number;version:number;settings:SavedSetting[]}|null;draft:(SettingInput & {id:string})|null;settings:SavedSetting[];drafts:(SettingInput & {id:string})[];history:SavedSetting[];sourceToken:string;changes:{id:string;settingId:string;before:SavedSetting|null;after:SavedSetting|null;decision:'pending'|'apply'|'reject'}[]}
export type StoryContext = {title:string;summary:string;basisEpisode:number;character:string;settings:SavedSetting[];draft:string;episodes:{number:number;version:number;versionId:string;title:string;sourceCharacters:number;excerpts:{start:number;end:number;text:string}[]}[];selection:{method:string;omittedCharacters:number;eligibleEpisodes:number;note:string}}
export type Version = Draft & { id: string; episode: number; savedAt: string }
export type History = { versions: Version[]; proposals: Proposal[] }

/** 회차 체크포인트(DEC-43)는 발행본이다. versionId는 저장 버전 id, active는 현재 독자 공개본이며 발행 시각 오름차순이다. */
export type EpisodeCheckpoint = {versionId:string;publishedAt:string;active:boolean}
export type WritingEpisode = {hasDraft?:boolean;number:number;draft:Draft;versions:Version[];publishedVersionId:string|null;inherited:boolean;updatedAt:string|null;checkpointStatus:string;checkpoints:EpisodeCheckpoint[]}

export type EpisodeOrderScope = {number:number;candidateNumbers:number[];reasons:string[];executable:false}
