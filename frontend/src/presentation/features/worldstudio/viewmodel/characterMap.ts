import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import { relationDefinitions, relationShortName } from '../../../../domain/entities/studioRelations'
import { buildWorldMap, mapEndpoint, type MapLink, type MapNode } from './useWorldMapViewModel'
import { cardTypeOf, cardTypes, isCard, type CardType } from '../../../../domain/entities/studioCards'

export function buildCharacterMap(settings:StudioSetting[]) {
 return relationshipMap(settings,settings.filter(s=>s.item.kind==='entity'&&s.item.entityType==='character'))
}
export function buildSettingRelationshipMap(settings:StudioSetting[]) {
 return relationshipMap(settings,settings.filter(s=>isCard(s.item)))
}
function relationshipMap(settings:StudioSetting[],cards:StudioSetting[]) {
 const byId=new Map(cards.map(s=>[s.item.id,s.item])),titleOf=(id:string|null)=>id?byId.get(id)?.title:undefined
 const nodes=buildWorldMap(cards).nodes.map(n=>{
  const item=byId.get(n.id)
  return {...n,name:item?.title||(n.kind==='인물'?'새 인물':'새 설정'),unnamed:!item?.title.trim(),type:item&&isCard(item)?cardTypeOf(item):undefined}
 })
 const ids=new Set(nodes.map(n=>n.id)),links:MapLink[]=[]
 let missingLinks=0
 for(const {item} of settings.filter(s=>s.item.kind==='relation'&&s.item.decision==='approved')) {
  if(!item.subjectId||!item.targetId||item.subjectId===item.targetId||!ids.has(item.subjectId)||!ids.has(item.targetId)){missingLinks++;continue}
  const fullLabel=relationShortName(item,titleOf),label=Array.from(fullLabel).length>10?Array.from(fullLabel).slice(0,10).join('')+'…':fullLabel
  links.push({id:item.id,source:item.subjectId,target:item.targetId,label,fullLabel,description:item.text,symmetric:!!relationDefinitions[item.predicate??'']?.symmetric})
 }
 return {nodes,links,missingLinks}
}

/**
 * 관계도 유형 필터 체크박스: 그래프에 노드가 있는 유형만, 기본 8종 순서 다음에 운영자가 추가한 유형(노드에 나온 순서)을 그 개수와 함께.
 * `nameOf`는 유형 이름을 정한다(기본은 기본 8종 이름, 모르는 유형은 '기타').
 */
export const cardTypeCounts=(nodes:MapNode[],nameOf:(type:CardType)=>string=type=>cardTypes.find(t=>t.id===type)?.label??'기타')=>{
 const present=[...new Set(nodes.flatMap(n=>n.type?[n.type]:[]))]
 const order=[...cardTypes.map(t=>t.id as string),...present.filter(type=>!cardTypes.some(t=>t.id===type))]
 return order.map(id=>({id,label:nameOf(id),count:nodes.filter(n=>n.type===id).length})).filter(t=>t.count>0)
}

/** 숨긴 유형의 노드와 그 노드에 닿는 간선(한쪽 끝만 닿아도)을 뺀 그래프. 화면 보기용이라 원본은 그대로이고, 숨긴 유형이 없으면 같은 그래프를 돌려준다. */
export function hideCardTypes(graph:ReturnType<typeof buildWorldMap>,hidden:ReadonlySet<CardType>) {
 if(!hidden.size)return graph
 const nodes=graph.nodes.filter(n=>!n.type||!hidden.has(n.type)),ids=new Set(nodes.map(n=>n.id))
 return {...graph,nodes,links:graph.links.filter(l=>ids.has(mapEndpoint(l.source))&&ids.has(mapEndpoint(l.target)))}
}

/** 유형 체크박스를 눌렀을 때의 숨김 집합. 숨긴 유형은 다시 보이게 하고, 보이는 유형이 그것 하나뿐이면 끄지 않고(빈 그래프가 되지 않게) 같은 집합을 돌려준다. */
export function toggleHiddenType(hidden:ReadonlySet<CardType>,type:CardType,present:readonly CardType[]):ReadonlySet<CardType> {
 const next=new Set(hidden)
 if(next.delete(type))return next
 next.add(type)
 return present.some(t=>!next.has(t))?next:hidden
}
