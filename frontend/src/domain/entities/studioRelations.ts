import {cardTypes,cardTypeOf} from './studioCards'
import { authorEdit, newSetting, type SettingItem, type StudioSetting } from './studioWorld'

export const relationDefinitions:Record<string,{label:string;group:'fact'|'emotion'|'other';symmetric?:boolean}>={
 custom_relation:{label:'직접 쓴 관계',group:'fact',symmetric:true},custom_relation_directed:{label:'직접 쓴 방향 관계',group:'fact'},custom_emotion:{label:'직접 쓴 감정',group:'emotion'},
 friend_of:{label:'친구',group:'fact',symmetric:true}, sibling_of:{label:'남매·형제자매',group:'fact',symmetric:true},
 child_of:{label:'자녀 → 부모',group:'fact'}, parent_of:{label:'부모 → 자녀',group:'fact'}, spouse_of:{label:'배우자',group:'fact',symmetric:true},
 trusts:{label:'신뢰',group:'emotion'}, wary_of:{label:'경계',group:'emotion'}, likes:{label:'호감',group:'emotion'}, hostile_to:{label:'적대',group:'emotion'},
 member_of:{label:'소속',group:'other'}, leads:{label:'이끎',group:'other'}, can_use:{label:'사용 가능',group:'other'}, located_in:{label:'위치',group:'other'},
}
export type RelationInput=Pick<SettingItem,'subjectId'|'targetId'|'predicate'|'polarity'> & Partial<Pick<SettingItem,'id'|'title'|'text'>>
export const isFreeRelation=(predicate:string|null|undefined)=>['custom_relation','custom_relation_directed','custom_emotion'].includes(predicate??'')
export function relationLabel(item:Pick<SettingItem,'predicate'|'polarity'>&Partial<Pick<SettingItem,'text'>>) {
 return ((isFreeRelation(item.predicate)?item.text:undefined)??relationDefinitions[item.predicate??'']?.label??item.predicate??'관계')+(item.polarity==='denied'?' 아님':'')
}
export function sameRelation(a:RelationInput,b:RelationInput) {
 if(a.predicate!==b.predicate||a.polarity!==b.polarity)return false
 if(isFreeRelation(a.predicate)&&a.text!==b.text)return false
 return a.subjectId===b.subjectId&&a.targetId===b.targetId || !!relationDefinitions[a.predicate??'']?.symmetric&&a.subjectId===b.targetId&&a.targetId===b.subjectId
}
function generatedDescription(item:RelationInput,settings:StudioSetting[]) {
 const name=(id:string|null)=>settings.find(s=>s.item.id===id)?.item.title??'선택 안 함'
 const label=isFreeRelation(item.predicate)?item.predicate==='custom_emotion'?'감정':'관계':relationLabel(item)
 return `${name(item.subjectId)} · ${label} · ${name(item.targetId)}`
}
export function editStudioSetting(settings:StudioSetting[],id:string,patch:Partial<SettingItem>,labels?:Partial<StudioSetting>) {
 const edited=settings.map(s=>s.item.id===id?{...(Object.entries(patch).some(([key,value])=>JSON.stringify(s.item[key as keyof SettingItem])!==JSON.stringify(value))?authorEdit(s,patch):s),...labels}:s)
 return edited.map(row=>{
  const before=settings.find(s=>s.item.id===row.item.id)
  if(!before||before.item.kind!=='relation'||row.item.kind!=='relation')return row
  const previous=generatedDescription(before.item,settings),next=generatedDescription(row.item,edited)
  // shortcut: template-identical manual fields also follow structure; add an explicit mode if authors need to freeze that exact format.
  const title=before.item.title===previous.slice(0,200)&&row.item.title===before.item.title?next.slice(0,200):row.item.title
  const text=!isFreeRelation(row.item.predicate)&&before.item.text===previous&&row.item.text===before.item.text?next:row.item.text
  return title===row.item.title&&text===row.item.text?row:authorEdit(row,{title,text})
 })
}
export function putRelation(settings:StudioSetting[],input:RelationInput):StudioSetting[] {
 const people=settings.filter(s=>cardTypes.some(type=>type.id===cardTypeOf(s.item)))
 const source=people.find(s=>s.item.id===input.subjectId),target=people.find(s=>s.item.id===input.targetId)
 if(!source||!target||source===target)throw new Error('서로 다른 설정 카드 두 개를 선택해 주세요.')
 if(!relationDefinitions[input.predicate??''] || relationDefinitions[input.predicate??''].group==='other')throw new Error('구조 관계 또는 감정을 선택해 주세요.')
 if(settings.some(s=>s.item.kind==='relation'&&s.item.id!==input.id&&sameRelation(s.item,input)))throw new Error('같은 방향과 종류의 관계가 이미 있습니다. 기존 연결을 선택해 수정해 주세요.')
 const existing=settings.find(s=>s.item.id===input.id)
 if(input.id&&(!existing||existing.item.kind!=='relation'))throw new Error('수정할 관계를 찾을 수 없습니다.')
 const base=newSetting()
 const generated=generatedDescription(input,settings)
 const title=input.title??generated.slice(0,200)
 const text=input.text??generated
 if(!title.trim()||title.length>200||!text.trim()||text.length>3000)throw new Error('관계 이름은 200자, 설명은 3,000자 이내로 입력해 주세요.')
 if(existing)return editStudioSetting(settings,existing.item.id,{...input,kind:'relation',entityType:null,title,text})
 const next=authorEdit(base,{...input,kind:'relation',entityType:null,title,text})
 return [...settings,next]
}
export function applyRelationChanges(settings:StudioSetting[],changes:(RelationInput&{baseline?:RelationInput})[],removedIds:string[]) {
 for(const {id,baseline} of changes) {
  if(!baseline)continue
  const current=settings.find(s=>s.item.id===id)?.item
  if(!current||current.kind!=='relation'||(['subjectId','targetId','predicate','polarity','title','text'] as const).some(key=>current[key]!==baseline[key]))throw new Error('다른 곳에서 관계가 변경되어 적용하지 못했습니다. 입력은 유지됩니다. 필요한 내용을 복사한 뒤 취소하고 관계를 다시 열어 주세요.')
 }
 const ids=changes.flatMap(c=>c.id?[c.id]:[])
 if(new Set(ids).size!==ids.length||ids.some(id=>removedIds.includes(id)))throw new Error('같은 관계의 수정과 삭제를 중복 적용할 수 없습니다.')
 if(removedIds.some(id=>settings.find(s=>s.item.id===id)?.item.kind!=='relation'))throw new Error('삭제할 관계를 찾을 수 없습니다.')
 let next=removedIds.length?settings.filter(s=>!removedIds.includes(s.item.id)):settings
 const editedIds:string[]=[]
 for(const change of changes.filter(c=>c.id)) {
  const before=next.find(s=>s.item.id===change.id)
  if(before?.item.kind!=='relation')throw new Error('수정할 관계를 찾을 수 없습니다.')
  const patch:Partial<SettingItem>={subjectId:change.subjectId,targetId:change.targetId,predicate:change.predicate,polarity:change.polarity,...(change.title!==undefined?{title:change.title}:{}),...(change.text!==undefined?{text:change.text}:{})}
  if(Object.entries(patch).every(([key,value])=>before.item[key as keyof SettingItem]===value))continue
  next=editStudioSetting(next,change.id!,patch);editedIds.push(change.id!)
 }
 for(const change of changes.filter(c=>!c.id))next=putRelation(next,change)
 for(const id of editedIds) {
  const row=next.find(s=>s.item.id===id)!
  // Validate the final batch, so exchanging two relationship types is atomic.
  putRelation(next,row.item)
  if(!row.item.title.trim()||row.item.title.length>200||!row.item.text.trim()||row.item.text.length>3000)throw new Error('관계 이름과 설명의 길이를 확인해 주세요.')
 }
 if(next.some(s=>[s.item.subjectId,s.item.targetId,s.item.afterId,...s.item.relatedIds].some(id=>id!==null&&removedIds.includes(id))))throw new Error('다른 설정에서 참조하는 관계입니다. 연결을 먼저 정리해 주세요.')
 return next
}
export function removeRelation(settings:StudioSetting[],id:string) {
 if(settings.find(s=>s.item.id===id)?.item.kind!=='relation')throw new Error('삭제할 관계를 찾을 수 없습니다.')
 if(settings.some(s=>s.item.id!==id&&[s.item.subjectId,s.item.targetId,s.item.afterId,...s.item.relatedIds].includes(id)))throw new Error('다른 설정에서 참조하는 관계입니다. 연결을 먼저 정리해 주세요.')
 return settings.filter(s=>s.item.id!==id)
}

export function personDeletionInfo(settings:StudioSetting[],id:string) {
 const person=settings.find(s=>s.item.id===id&&s.item.kind==='entity'&&s.item.entityType==='character')
 if(!person)throw new Error('삭제할 인물을 찾을 수 없습니다.')
 const relations=settings.filter(s=>s.item.kind==='relation'&&(s.item.subjectId===id||s.item.targetId===id))
 const removed=new Set([id,...relations.map(s=>s.item.id)])
 const blockers=settings.filter(s=>!removed.has(s.item.id)&&[s.item.subjectId,s.item.targetId,s.item.afterId,...s.item.relatedIds].some(ref=>ref!==null&&removed.has(ref)))
 return {person,relations,blockers}
}
export function removePerson(settings:StudioSetting[],id:string) {
 const {relations,blockers}=personDeletionInfo(settings,id)
 if(blockers.length)throw new Error(`다른 설정에서 참조하고 있어 삭제할 수 없습니다: ${blockers.map(s=>s.item.title).join(', ')}`)
 const removed=new Set([id,...relations.map(s=>s.item.id)])
 return settings.filter(s=>!removed.has(s.item.id))
}
