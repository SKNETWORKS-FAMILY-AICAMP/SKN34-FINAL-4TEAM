import type {SettingItem,StudioSetting} from './studioWorld'

export const cardTypes=[{id:'character',label:'인물'},{id:'location',label:'장소'},{id:'organization',label:'조직'},{id:'ability',label:'능력'},{id:'object',label:'사물'},{id:'rule',label:'규칙'},{id:'event',label:'사건'},{id:'other',label:'기타'}] as const
export type CardType=typeof cardTypes[number]['id']
export type CardFilter=CardType|'all'|'note'|'relation'|'review'
export const settingAreas=[{id:'basic',label:'기본 설정'},{id:'space',label:'시공간'},{id:'history',label:'역사'},{id:'society',label:'사회'},{id:'culture',label:'문화·기술'},{id:'special',label:'특수 규칙'},{id:'conflict',label:'주요 갈등'}] as const
export function cardTypeOf(item:SettingItem):Exclude<CardFilter,'all'> {
 if(item.kind==='entity')return cardTypes.find(t=>!['rule','event'].includes(t.id)&&t.id===item.entityType)?.id??'review'
 if(item.kind==='rule'||item.kind==='event'||item.kind==='note'||item.kind==='relation')return item.kind
 return 'review'
}
export function areaPatch(item:SettingItem,category:SettingItem['category']):Partial<SettingItem> {
 if(item.kind==='event'&&category!=='history')throw new Error('현재 저장 방식에서 사건은 역사 영역에만 저장할 수 있어요.')
 if(item.topics.length&&!item.topics.some(t=>t.startsWith(category+'.')))throw new Error('기존 분석 분류를 보존하기 위해 이 항목의 영역 변경은 아직 지원하지 않아요.')
 return {category}
}
export function cardTypePatch(item:SettingItem,type:CardType,settings:StudioSetting[]):Partial<SettingItem> {
 if(type==='object'||type==='other')throw new Error('사물·기타의 정확한 유형 저장은 Core 확장 후 지원합니다.')
 if(cardTypeOf(item)===type)return {}
 if(['claim','constraint','undetermined','relation','note'].includes(item.kind)||item.subjectId||item.targetId||item.relatedIds.length||item.condition||item.timeText||item.afterId||item.topics.length||item.evidence.length)throw new Error('기존 의미·근거를 보존해야 하는 항목이에요. 유형 변경은 통합 후 지원합니다.')
 if(settings.some(s=>s.item.id!==item.id&&[s.item.subjectId,s.item.targetId,s.item.afterId,...s.item.relatedIds].includes(item.id)))throw new Error('다른 설정과 연결된 카드예요. 연결을 보존하기 위해 유형을 변경할 수 없어요.')
 const entity=['character','location','organization','ability','object'].includes(type)
 return {kind:entity?'entity':type==='rule'?'rule':'event',entityType:entity?type:null,...(type==='event'?{category:'history' as const}:{})}
}
export function storageLimitations(settings:StudioSetting[]):string[] {
 const reasons:string[]=[]
 if(settings.some(s=>s.item.entityType==='object'||s.item.entityType==='other'))reasons.push('사물·기타 유형은 현재 서버가 정확히 보존하지 못해 저장할 수 없어요. Core 저장 계약 확장이 필요합니다.')
 if(settings.some(s=>s.aliases?.length))reasons.push('별칭은 현재 서버가 보존하지 못해 저장할 수 없어요. Core 저장 계약 확장이 필요합니다.')
 return reasons
}
