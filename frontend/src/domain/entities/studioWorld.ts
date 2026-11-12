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
export type StudioSetting = {serverMetadata?:Record<string,unknown>;item:SettingItem;userCategory:string;tags:string[];aliases?:string[]}
/** 세계관 단위 공개 설정(설정 카드 단위 공개와 다르다). 값이 없으면 비공개·장르 미지정이다(서버가 이 필드를 주기 전 응답과 메모리 데모). */
export type WorldVisibility = 'private'|'public'
export type WorldPublicationInput = {visibility:WorldVisibility;genre:PublicWorldGenre|null}
/** `listed`는 지금 공개 목록·상세에 실제로 나오는지다. 공개로 설정해도 확정 버전이 없으면 false이고, `publishedAt`은 비공개이면 null이다. */
export type WorldPublication = WorldPublicationInput & {worldId:string;publishedAt:string|null;listed:boolean}
export type StudioWorld = {currentRevisionId?:string|null;id:string;name:string;description:string;version:number;visibility?:WorldVisibility;genre?:PublicWorldGenre|null;/** 올린 표지가 있는지(없으면 자동 생성 표지). 값이 없으면 없다. */hasCover?:boolean;settings:StudioSetting[];relationshipStatus?:'current'|'incomplete'|'migration_required';analysis:{id:string;status:string;candidates:SettingItem[];issues:string[]}|null}
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
