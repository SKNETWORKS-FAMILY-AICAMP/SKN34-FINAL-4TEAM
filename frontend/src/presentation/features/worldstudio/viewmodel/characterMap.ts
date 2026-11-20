import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import { relationDefinitions, relationLabel } from '../../../../domain/entities/studioRelations'
import { buildWorldMap, mapEndpoint, type MapLink, type MapNode } from './useWorldMapViewModel'
import { cardTypeOf, cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { pageItems } from '../../../shared/pageItems'

export function buildCharacterMap(settings:StudioSetting[]) {
 return relationshipMap(settings,settings.filter(s=>s.item.kind==='entity'&&s.item.entityType==='character'))
}
export function buildSettingRelationshipMap(settings:StudioSetting[]) {
 return relationshipMap(settings,settings.filter(s=>cardTypes.some(t=>t.id===cardTypeOf(s.item))))
}
function relationshipMap(settings:StudioSetting[],cards:StudioSetting[]) {
 const byId=new Map(cards.map(s=>[s.item.id,s.item]))
 const nodes=buildWorldMap(cards).nodes.map(n=>{
  const item=byId.get(n.id)
  return {...n,name:item?.title||(n.kind==='인물'?'새 인물':'새 설정'),unnamed:!item?.title.trim(),type:item&&cardTypes.find(t=>t.id===cardTypeOf(item))?.id}
 })
 const ids=new Set(nodes.map(n=>n.id)),links:MapLink[]=[]
 let missingLinks=0
 for(const {item} of settings.filter(s=>s.item.kind==='relation'&&s.item.decision==='approved')) {
  if(!item.subjectId||!item.targetId||item.subjectId===item.targetId||!ids.has(item.subjectId)||!ids.has(item.targetId)){missingLinks++;continue}
  const fullLabel=relationLabel(item),label=Array.from(fullLabel).length>10?Array.from(fullLabel).slice(0,10).join('')+'…':fullLabel
  links.push({id:item.id,source:item.subjectId,target:item.targetId,label,fullLabel,description:item.text,symmetric:!!relationDefinitions[item.predicate??'']?.symmetric,emotion:relationDefinitions[item.predicate??'']?.group==='emotion'})
 }
 const pairs=new Map<string,MapLink[]>()
 for(const link of links){const key=[link.source,link.target].sort().join(':');const pair=pairs.get(key)??[];pair.push(link);pairs.set(key,pair)}
 for(const pair of pairs.values())pair.forEach((link,index)=>{const direction=String(link.source)<String(link.target)?1:-1;link.curve=direction*(index-(pair.length-1)/2)*.35})
 return {nodes,links,missingLinks}
}

/** 관계도 유형 필터 버튼: 그래프에 노드가 있는 유형만 `cardTypes` 순서로, 그 개수와 함께. */
export const cardTypeCounts=(nodes:MapNode[])=>cardTypes.map(({id,label})=>({id,label,count:nodes.filter(n=>n.type===id).length})).filter(t=>t.count>0)

/** 숨긴 유형의 노드와 그 노드에 닿는 간선(한쪽 끝만 닿아도)을 뺀 그래프. 화면 보기용이라 원본은 그대로이고, 숨긴 유형이 없으면 같은 그래프를 돌려준다. */
export function hideCardTypes(graph:ReturnType<typeof buildWorldMap>,hidden:ReadonlySet<CardType>) {
 if(!hidden.size)return graph
 const nodes=graph.nodes.filter(n=>!n.type||!hidden.has(n.type)),ids=new Set(nodes.map(n=>n.id))
 return {...graph,nodes,links:graph.links.filter(l=>ids.has(mapEndpoint(l.source))&&ids.has(mapEndpoint(l.target)))}
}

/** 선택한 카드와 인접 카드의 한 페이지를 보여 준다. */
export function mapNeighbors(graph:ReturnType<typeof buildWorldMap>,anchor:string,page:number,size:number) {
 const node=graph.nodes.find(n=>n.id===anchor)
 if(!node)return {...graph,nodes:[],links:[]}
 const links=graph.links.filter(l=>mapEndpoint(l.source)===anchor||mapEndpoint(l.target)===anchor)
 const neighborIds=new Set(links.map(l=>mapEndpoint(l.source)===anchor?mapEndpoint(l.target):mapEndpoint(l.source)))
 const nodes=pageItems(graph.nodes.filter(n=>neighborIds.has(n.id)),page,size).items,ids=new Set([anchor,...nodes.map(n=>n.id)])
 return {...graph,nodes:[node,...nodes],links:links.filter(l=>ids.has(mapEndpoint(l.source))&&ids.has(mapEndpoint(l.target)))}
}

/** 유형 버튼을 눌렀을 때의 숨김 집합. 숨긴 유형은 다시 보이게 하고, 보이는 유형이 그것 하나뿐이면 끄지 않고(빈 그래프가 되지 않게) 같은 집합을 돌려준다. */
export function toggleHiddenType(hidden:ReadonlySet<CardType>,type:CardType,present:readonly CardType[]):ReadonlySet<CardType> {
 const next=new Set(hidden)
 if(next.delete(type))return next
 next.add(type)
 return present.some(t=>!next.has(t))?next:hidden
}
