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

/**
 * 관계도를 처음 열 때 보는 중심 카드: 승인된 관계가 가장 많은 인물, 인물에게 관계가 하나도 없으면 관계가 가장 많은 카드, 관계가 하나도 없으면 ''(전체 보기)다. 동률이면 그래프의 앞선 카드다.
 * 57장·142관계처럼 큰 세계관은 전체를 한 번에 깔면 읽을 수 없어 이 카드와 이웃만 먼저 보이고, 전체는 '전체 관계도로'로 본다.
 */
export function defaultAnchor(graph:ReturnType<typeof buildWorldMap>) {
 const degree=new Map<string,number>()
 for(const l of graph.links)for(const id of [mapEndpoint(l.source),mapEndpoint(l.target)])degree.set(id,(degree.get(id)??0)+1)
 const most=(nodes:MapNode[])=>nodes.reduce<MapNode|undefined>((best,n)=>(degree.get(n.id)??0)>(degree.get(best?.id??'')??0)?n:best,undefined)
 return (most(graph.nodes.filter(n=>n.type==='character'))??most(graph.nodes))?.id??''
}

/**
 * 중심 카드 보기의 원형 배치. 좌표는 카드의 왼쪽 위 모서리다(격자 배치와 같다). 중심 카드는 원점(0, 0)을 한가운데로 두고, 이웃 ${count}장은 그 둘레에 중심 바로 위에서 시계 방향으로 같은 간격으로 놓인다.
 * 반지름은 이웃끼리 겹치지 않을 만큼(카드 폭 × 개수 ÷ 2π × 1.25, 최소 260px)이라 중심과 이웃, 이웃끼리 카드가 겹치지 않는다(1.15면 9·11장에서 카드 모서리가 겹쳤다).
 * 화면에 맞춘 축소는 하지 않는다: 카드는 늘 같은 크기이고 캔버스(React Flow)의 화면 맞춤·확대·축소가 맡는다(예전에는 보드 폭에 맞춰 카드째 0.55배까지 줄였다).
 */
export function ringLayout(count:number,cardW:number,cardH:number) {
 const radius=count?Math.max(260,count*cardW/(2*Math.PI)*1.25):0
 const place=(x:number,y:number)=>({x:x-cardW/2,y:y-cardH/2})
 return {center:place(0,0),ring:Array.from({length:count},(_,i)=>{const angle=-Math.PI/2+2*Math.PI*i/count;return place(radius*Math.cos(angle),radius*Math.sin(angle))})}
}

/** 선 라벨의 각도(도): 선 방향으로 눕히되 글자가 거꾸로 뒤집히지 않게 -90° 초과 90° 이하로 맞춘다. 이웃이 둘레에 퍼진 중심 보기에서 라벨이 자기 선을 따라 누워 이웃 선의 라벨과 겹치지 않는다. */
export function labelAngle(dx:number,dy:number) {
 const angle=Math.atan2(dy,dx)*180/Math.PI
 return angle>90?angle-180:angle<=-90?angle+180:angle
}

/** 유형 버튼을 눌렀을 때의 숨김 집합. 숨긴 유형은 다시 보이게 하고, 보이는 유형이 그것 하나뿐이면 끄지 않고(빈 그래프가 되지 않게) 같은 집합을 돌려준다. */
export function toggleHiddenType(hidden:ReadonlySet<CardType>,type:CardType,present:readonly CardType[]):ReadonlySet<CardType> {
 const next=new Set(hidden)
 if(next.delete(type))return next
 next.add(type)
 return present.some(t=>!next.has(t))?next:hidden
}
