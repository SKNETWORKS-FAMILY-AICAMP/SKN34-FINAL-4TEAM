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
export type StudioWorld = {currentRevisionId?:string|null;id:string;name:string;description:string;version:number;settings:StudioSetting[];relationshipStatus?:'current'|'incomplete'|'migration_required';analysis:{id:string;status:string;candidates:SettingItem[];issues:string[]}|null}
export const newSetting = (section:StudioSection='basic'):StudioSetting => ({userCategory:'설정',tags:[],item:{id:crypto.randomUUID(),title:'',text:'',topics:[],subjectId:null,targetId:null,predicate:null,polarity:'asserted',relatedIds:[],condition:'',timeText:'',afterId:null,orderEvidence:[],evidence:[],origin:'author_addition',authorText:'',decision:'approved',...sectionFields(section)}})
export function authorEdit(setting:StudioSetting,patch:Partial<SettingItem>):StudioSetting {
 const item={...setting.item,...patch,origin:'author_addition' as const,decision:'approved' as const,evidence:[],orderEvidence:[]}
 return {...setting,item:{...item,authorText:item.text}}
}

export function studioLabelCleanup(values?:string[]):string[]|undefined {
 if(!values?.some(value=>!value||value!==value.trim()))return
 return values.map(value=>value.trim()).filter(Boolean)
}

export type WorldRevisionSummary={worldId:string;revisionId:string;revisionNo:number;name:string;createdAt:string}
export type WorldRevision={worldId:string;revisionId:string;revisionNo:number;name:string;description:string;parentRevisionId:string|null;restoredFromRevisionId:string|null;relationshipStatus:'not_recorded';relationships:null;cards:{versionId:string;versionNo:number;restoredFromVersionId:string|null;card:{id:string;title:string;body:string;cardType:string;areaCode:string;classification:string;aliases:string[];tags:string[];semanticMetadata:Record<string,unknown>;visibility:'private'|'public';lifecycle:'active'|'removed'}}[]}
