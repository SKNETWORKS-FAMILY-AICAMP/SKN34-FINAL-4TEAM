import type { PublicWorldGenre } from './publicWorld'
import { sectionFields, type StudioSection } from './studioSections'
export type SettingItem = {
 semanticType?:'fact'|'relation'|'rule'|'event'|'conjecture'|'goal'|'plan'
 id: string; kind: 'entity'|'fact'|'rule'|'constraint'|'claim'|'relation'|'undetermined'|'event'|'note'; title: string; text: string
 category: 'basic'|'space'|'history'|'society'|'culture'|'special'|'conflict'; topics: string[]
 entityType: string|null; subjectId: string|null; targetId: string|null; predicate: string|null
 polarity: 'asserted'|'denied'; relatedIds: string[]; condition: string; timeText: string; afterId: string|null
 orderEvidence: {sourceId:string;quote:string}[]; evidence: {sourceId:string;quote:string}[]
 origin: 'extraction'|'correction'|'author_addition'|'author_input'; authorText: string|null; decision: 'pending'|'approved'|'rejected'|'held'
}
<<<<<<< HEAD
export type StudioSetting = {item:SettingItem;userCategory:string;tags:string[];aliases?:string[];templateOrder?:number}
export type StudioWorld = {id:string;name:string;description:string;version:number;settings:StudioSetting[];relationshipStatus?:'current'|'incomplete'|'migration_required';analysis:{id:string;status:string;candidates:SettingItem[];issues:string[]}|null}
=======
/** 설정 카드 단위 공개(DEC-46). 세계관 단위 공개([WorldVisibility])와 다르다. */
export type CardVisibility = 'private'|'public'
/** 다른 세계관에서 가져온 카드의 출처 스냅샷(DEC-46). 가져온 뒤 원본의 변경·비공개 전환·삭제는 반영하지 않는다. */
export type ImportedFrom = {worldId:string;worldName:string;authorNickname:string;revisionNo:number;cardId:string}
/**
 * 인물 카드의 작가용 문서. 인물 카드는 문서 네 종류로 쓴다: `IDENTITY.md`는 카드 본문(`item.text`)이고, 여기에는 나머지인
 * `SOUL.md`(soul)·`MEMORY.md`(memory)·회차별 기억 `memory/NN회차.md`(episodes, 키는 0 이상의 정수인 회차 번호)를 둔다.
 * 공개 세계관·독자 설정 위키에는 본문만 나가고 이 문서들은 나가지 않는다. 규칙은 `characterDocs.ts`에 있다.
 */
export type CharacterDocs = {soul:string;memory:string;episodes:Record<number,string>}
export type StudioSetting = {serverMetadata?:Record<string,unknown>;item:SettingItem;userCategory:string;tags:string[];aliases?:string[]
 /** 카드 단위 공개. 없으면 비공개다. 관계 행에는 쓰지 않는다. */
 visibility?:CardVisibility
 /** 독자 공개 시작 회차(연결된 소설 기준, 1 이상 정수). 없으면 독자에게 숨긴다. */
 revealFromEpisode?:number
 /** 다른 세계관에서 가져온 카드의 출처. 직접 만든 카드에는 없다. */
 importedFrom?:ImportedFrom
 /** 인물 문서(SOUL.md·MEMORY.md·회차별 기억). 인물 카드에만 쓰고, 없으면 본문(IDENTITY.md)만 있는 인물이다. */
 characterDocs?:CharacterDocs}
/** 독자 공개 회차가 잘못됐는지: 값이 있는데 1 이상의 정수가 아니다. 저장 전 확인([worldWritingIssues])과 저장 검증(WorldStudioUseCase.save)이 같은 규칙·문구를 쓴다. */
export const REVEAL_EPISODE_ERROR='독자 공개 회차는 1 이상의 정수로 입력해 주세요.'
export const invalidReveal=({revealFromEpisode:n}:Pick<StudioSetting,'revealFromEpisode'>)=>n!==undefined&&!(Number.isInteger(n)&&n>=1)
/** 세계관 단위 공개 설정(설정 카드 단위 공개와 다르다). 값이 없으면 비공개·장르 미지정이다(서버가 이 필드를 주기 전 응답과 메모리 데모). */
export type WorldVisibility = 'private'|'public'
export type WorldPublicationInput = {visibility:WorldVisibility;genre:PublicWorldGenre|null}
/** `listed`는 지금 공개 목록·상세에 실제로 나오는지다. 공개로 설정해도 확정 버전이 없으면 false이고, `publishedAt`은 비공개이면 null이다. */
export type WorldPublication = WorldPublicationInput & {worldId:string;publishedAt:string|null;listed:boolean}
export type StudioWorld = {currentRevisionId?:string|null;id:string;name:string;description:string;version:number;visibility?:WorldVisibility;genre?:PublicWorldGenre|null;/** 올린 표지가 있는지(없으면 자동 생성 표지). 값이 없으면 없다. */hasCover?:boolean;/** 이 세계관에 연결된 내 소설 id(DEC-46 1:1 연결). 없으면 미연결이다. */linkedWorkId?:string|null;settings:StudioSetting[];relationshipStatus?:'current'|'incomplete'|'migration_required';analysis:{id:string;status:string;candidates:SettingItem[];issues:string[]}|null}
>>>>>>> 243423237fe91204f89d25cab238c64cabe6e285
export const newSetting = (section:StudioSection='basic'):StudioSetting => ({userCategory:'설정',tags:[],item:{id:crypto.randomUUID(),title:'',text:'',topics:[],subjectId:null,targetId:null,predicate:null,polarity:'asserted',relatedIds:[],condition:'',timeText:'',afterId:null,orderEvidence:[],evidence:[],origin:'author_addition',authorText:'',decision:'approved',...sectionFields(section)}})
export function authorEdit(setting:StudioSetting,patch:Partial<SettingItem>):StudioSetting {
 const item={...setting.item,...patch,origin:'author_addition' as const,decision:'approved' as const,evidence:[],orderEvidence:[]}
 return {...setting,item:{...item,authorText:item.text}}
}

/** 세계관 표지로 올릴 수 있는 형식과 크기(서버가 실제 바이트로 다시 검사한다). */
export const WORLD_COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const WORLD_COVER_MAX_BYTES = 5 * 1024 * 1024
/** 표지 파일을 보내기 전에 거른다: 빈 파일, PNG·JPEG·WebP가 아닌 형식, 5 MiB 초과. 문제가 없으면 null이다. */
export function worldCoverError(file: Pick<File, 'type' | 'size'>): string | null {
 if (!file.size) return '빈 파일은 표지로 쓸 수 없어요.'
 if (!(WORLD_COVER_TYPES as readonly string[]).includes(file.type)) return 'PNG·JPEG·WebP 이미지만 표지로 쓸 수 있어요.'
 if (file.size > WORLD_COVER_MAX_BYTES) return '표지는 5 MiB 이하여야 해요.'
 return null
}

export function studioLabelCleanup(values?:string[]):string[]|undefined {
 if(!values?.some(value=>!value||value!==value.trim()))return
 return values.map(value=>value.trim()).filter(Boolean)
}

export type WorldRevisionSummary={worldId:string;revisionId:string;revisionNo:number;name:string;createdAt:string}
export type WorldRevision={worldId:string;revisionId:string;revisionNo:number;name:string;description:string;parentRevisionId:string|null;restoredFromRevisionId:string|null;relationshipStatus:'not_recorded';relationships:null;cards:{versionId:string;versionNo:number;restoredFromVersionId:string|null;card:{id:string;title:string;body:string;cardType:string;areaCode:string;classification:string;aliases:string[];tags:string[];semanticMetadata:Record<string,unknown>;visibility:'private'|'public';lifecycle:'active'|'removed'}}[]}
