import {expect,it} from 'vitest'
import {newSetting} from '../../../../domain/entities/studioWorld'
import {putRelation} from '../../../../domain/entities/studioRelations'
import {cardTypePatch,type CardType} from '../../../../domain/entities/studioCards'
import {mapConnectionLabel,type MapNode} from './useWorldMapViewModel'
import {buildCharacterMap,buildSettingRelationshipMap,cardTypeCounts,hideCardTypes,toggleHiddenType,mapNeighbors} from './characterMap'
it('선택한 카드의 다른 페이지 이웃과 관계를 유지한다',()=>{
 const cards=Array.from({length:101},(_,i)=>{const s=newSetting('people');s.item.title=`설정 ${i}`;return s})
 const rows=putRelation(cards,{subjectId:cards[0].item.id,targetId:cards[100].item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'동료'})
 const graph=mapNeighbors(buildSettingRelationshipMap(rows),cards[0].item.id,0,49)
 expect(graph.nodes.map(n=>n.id)).toEqual([cards[0].item.id,cards[100].item.id])
 expect(graph.links).toHaveLength(1)
})
it('이웃 페이지는 유형 필터를 따르고 입력과 관계 편집 상태를 바꾸지 않는다',()=>{
 const {a,b,place,graph}=typedWorld(),before=structuredClone(graph)
 const visible=hideCardTypes(graph,new Set<CardType>(['ability']))
 const second=mapNeighbors(visible,a.item.id,1,1)
 expect(second.nodes.map(n=>n.id)).toEqual([a.item.id,place.item.id])
 expect(second.links.map(l=>[l.source,l.target])).toEqual([[a.item.id,place.item.id]])
 expect(mapNeighbors(visible,a.item.id,0,1).nodes.map(n=>n.id)).toEqual([a.item.id,b.item.id])
 expect(graph).toEqual(before)
})
it('keeps locations and real directed relationships in the service card board',()=>{
 const person=newSetting('people'),place=newSetting('places')
 person.item.title='가람';place.item.title='항구'
 const rows=putRelation([person,place],{subjectId:person.item.id,targetId:place.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'지키는 장소'})
 const before=structuredClone(rows),graph=buildSettingRelationshipMap(rows)
 expect(graph.nodes.map(n=>n.id)).toEqual([person.item.id,place.item.id])
 expect(graph.links[0]).toMatchObject({id:rows[2].item.id,source:person.item.id,target:place.item.id,symmetric:false})
 expect(rows).toEqual(before)
})
it('2D character projection keeps person IDs and real relationship edges separate from locations',()=>{
 const a=newSetting('people'),b=newSetting('people'),place=newSetting('places')
 a.item.title='가람';b.item.title='나래';place.item.title='항구'
 const settings=putRelation([a,b,place],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'동료'})
 const before=structuredClone(settings),graph=buildCharacterMap(settings)
 expect(graph.nodes.map(n=>n.id)).toEqual([a.item.id,b.item.id])
 expect(graph.links).toHaveLength(1)
 expect(graph.links[0]).toMatchObject({id:settings[3].item.id,source:a.item.id,target:b.item.id,label:'동료'})
 graph.nodes[0].x=42;graph.links[0].source=graph.nodes[0]
 expect(settings).toEqual(before)
})

it('shows direction and complete description for both endpoints without changing general map labels',()=>{
 const link={source:'a',target:'b',label:'부모가 자녀를 보호…',fullLabel:'부모가 자녀를 보호하고 양육하는 관계',symmetric:false}
 expect(mapConnectionLabel(link,'a')).toBe('보내는 관계 · 부모가 자녀를 보호하고 양육하는 관계')
 expect(mapConnectionLabel({...link,source:{id:'a'} as MapNode,target:{id:'b'} as MapNode},'b')).toBe('받는 관계 · 부모가 자녀를 보호하고 양육하는 관계')
 expect(mapConnectionLabel({...link,symmetric:true},'a')).toBe('부모가 자녀를 보호하고 양육하는 관계')
 expect(mapConnectionLabel({source:'a',target:'b',label:'이후 사건',reverseLabel:'이전 사건'},'b')).toBe('이전 사건')
})
it('separates the effective geometry of opposite and same-direction links without changing input',()=>{
 const a=newSetting('people'),b=newSetting('people')
 let rows=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'trusts',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:b.item.id,targetId:a.item.id,predicate:'likes',polarity:'asserted'})
 rows=putRelation(rows,{subjectId:a.item.id,targetId:b.item.id,predicate:'wary_of',polarity:'asserted'})
 const before=structuredClone(rows),links=buildCharacterMap(rows).links
 expect(new Set(links.map(l=>l.curve!*(String(l.source)<String(l.target)?1:-1))).size).toBe(3)
 expect(rows).toEqual(before)
})

it('preserves an authored description even for a predefined directional relationship',()=>{
 const a=newSetting('people'),b=newSetting('people'),description='오랫동안 바다를 함께 건너온 동료를 믿는다'
 const rows=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'trusts',polarity:'asserted',text:description})
 const link=buildCharacterMap(rows).links[0]
 expect(link.label).toBe('신뢰')
 expect(mapConnectionLabel(link,a.item.id)).toBe('보내는 관계 · 신뢰 · '+description)
 expect(mapConnectionLabel(link,b.item.id)).toBe('받는 관계 · 신뢰 · '+description)
})

it('retains denial when the original description is a positive phrase',()=>{
 const link={source:'a',target:'b',label:'친구 아님',fullLabel:'친구 아님',description:'친구',symmetric:false}
 expect(mapConnectionLabel(link,'a')).toBe('보내는 관계 · 친구 아님 · 친구')
 expect(mapConnectionLabel(link,'b')).toBe('받는 관계 · 친구 아님 · 친구')
})

it('does not repeat a relation type already present in its description',()=>{
 const link={source:'a',target:'b',label:'신뢰',fullLabel:'신뢰',description:'가람 · 신뢰 · 나래',symmetric:false}
 expect(mapConnectionLabel(link,'a')).toBe('보내는 관계 · 가람 · 신뢰 · 나래')
})

it('does not treat a relation type within a different phrase as a duplicate',()=>{
 const link={source:'a',target:'b',label:'신뢰',fullLabel:'신뢰',description:'그를 신뢰하지 않는다',symmetric:false}
 expect(mapConnectionLabel(link,'a')).toBe('보내는 관계 · 신뢰 · 그를 신뢰하지 않는다')
})

it('preserves middle dots that are part of the relationship type',()=>{
 const link={source:'a',target:'b',label:'남매·형제자매',fullLabel:'남매·형제자매',description:'가람 · 남매·형제자매 · 나래',symmetric:true}
 expect(mapConnectionLabel(link,'a')).toBe('가람 · 남매·형제자매 · 나래')
})

// ── 관계도 유형 필터: 화면 보기 상태일 뿐이라 원본 데이터는 건드리지 않는다 ──
/** 앱이 카드를 더하는 방식(`addCard`)과 같게 만든 유형별 카드. */
const card=(type:CardType,title:string)=>{const s=newSetting();Object.assign(s.item,cardTypePatch(s.item,type,[]));s.item.title=title;return s}
/** 인물 둘·장소·능력 카드와 인물↔인물·인물↔장소·인물↔능력 관계 셋. */
function typedWorld() {
 const a=card('character','가람'),b=card('character','나래'),place=card('location','항구'),power=card('ability','해류술')
 const link=(rows:ReturnType<typeof card>[],from:ReturnType<typeof card>,to:ReturnType<typeof card>,text:string)=>putRelation(rows,{subjectId:from.item.id,targetId:to.item.id,predicate:'custom_relation_directed',polarity:'asserted',text})
 let rows=[a,b,place,power]
 rows=link(rows,a,b,'동료');rows=link(rows,a,place,'지키는 곳');rows=link(rows,b,power,'다룬다')
 return {a,b,place,power,graph:buildSettingRelationshipMap(rows)}
}

it('유형별 개수: 노드에 카드 유형 id를 싣고, 노드가 있는 유형만 카드 유형 순서대로 센다',()=>{
 const {graph}=typedWorld()
 expect(graph.nodes.map(n=>n.type)).toEqual(['character','character','location','ability'])
 expect(cardTypeCounts(graph.nodes)).toEqual([{id:'character',label:'인물',count:2},{id:'location',label:'장소',count:1},{id:'ability',label:'능력',count:1}])
 expect(cardTypeCounts([])).toEqual([])
})

it('숨긴 유형의 노드와, 한쪽 끝이라도 그 노드에 닿는 간선을 그래프에서 뺀다(원본은 그대로)',()=>{
 const {a,b,place,power,graph}=typedWorld(),before=structuredClone(graph)
 const shown=hideCardTypes(graph,new Set<CardType>(['location']))
 expect(shown.nodes.map(n=>n.id)).toEqual([a.item.id,b.item.id,power.item.id])
 expect(shown.links.map(l=>[l.source,l.target])).toEqual([[a.item.id,b.item.id],[b.item.id,power.item.id]]) // 가람→항구는 항구가 숨어 빠진다
 expect(graph).toEqual(before)
 const people=hideCardTypes(graph,new Set<CardType>(['character']))
 expect(people.nodes.map(n=>n.id)).toEqual([place.item.id,power.item.id])
 expect(people.links).toEqual([]) // 모든 간선이 인물에 닿는다
})

it('아무것도 숨기지 않으면 원본과 같은 그래프이고, 노드가 없는 유형을 숨겨도 내용이 같다',()=>{
 const {graph}=typedWorld()
 expect(hideCardTypes(graph,new Set())).toBe(graph)
 expect(hideCardTypes(graph,new Set<CardType>(['organization']))).toEqual(graph)
})

it('유형 버튼은 하나씩 켜고 끄되, 보이는 유형이 하나뿐이면 그것을 끄는 요청은 무시한다(빈 그래프가 되지 않게)',()=>{
 const present:CardType[]=['character','location'],none=new Set<CardType>()
 const hidden=toggleHiddenType(none,'location',present)
 expect([...hidden]).toEqual(['location'])
 expect(toggleHiddenType(hidden,'character',present)).toBe(hidden) // 인물까지 끄면 모두 숨으니 같은 집합을 돌려준다
 expect([...toggleHiddenType(hidden,'location',present)]).toEqual([]) // 숨긴 유형을 다시 누르면 보인다
 expect(none.size).toBe(0)
 const stale=new Set<CardType>(['organization']) // 그래프에 이미 없는 유형이 숨김 집합에 남아 있어도 보이는 유형은 인물 하나뿐이다
 expect(toggleHiddenType(stale,'character',['character'])).toBe(stale)
})
