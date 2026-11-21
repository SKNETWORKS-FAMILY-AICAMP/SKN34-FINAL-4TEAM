import {expect,it} from 'vitest'
import {newSetting} from '../../../../domain/entities/studioWorld'
import {putRelation} from '../../../../domain/entities/studioRelations'
import {cardTypePatch,type CardType} from '../../../../domain/entities/studioCards'
import {mapConnectionLabel,type MapNode} from './useWorldMapViewModel'
import {buildCharacterMap,buildSettingRelationshipMap,cardTypeCounts,defaultAnchor,hideCardTypes,toggleHiddenType,mapNeighbors,ringLayout,labelAngle} from './characterMap'
import {settingBoardEntries} from './settingBoard'
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

it('관계도 카드의 요약(노드 text)은 설정집 게시판 요약과 같이 본문의 링크·마크다운 기호를 글자만 남겨 정리한다 (#485 QA)',()=>{
 const a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 a.item.text='# 가람\n[나래](card:3f95a1c2-0b6d-4c1e-9a77-5e0d2c8b1a10)와 **오랜** 친구.'
 const board=settingBoardEntries([a,b]).find(e=>e.cardId===a.item.id)!.text // 게시판이 보이는 요약
 expect(board).toBe('가람 나래와 오랜 친구.')
 expect(buildSettingRelationshipMap([a,b]).nodes[0].text).toBe(board)
 expect(buildCharacterMap([a,b]).nodes[0].text).toBe(board)
})

// ── 관계도 중심 카드 보기(R5): 처음 보는 중심 카드와 원형 배치 ──────────────────────────────────────────
it('처음 보는 중심 카드는 승인된 관계가 가장 많은 인물이다 (동률이면 앞선 카드, 장소·사건이 더 많아도 인물을 먼저 본다)',()=>{
 const a=card('character','가람'),b=card('character','나래'),c=card('character','다온'),place=card('location','항구'),power=card('ability','해류술')
 const link=(rows:ReturnType<typeof card>[],from:ReturnType<typeof card>,to:ReturnType<typeof card>)=>putRelation(rows,{subjectId:from.item.id,targetId:to.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'관계'})
 const cards=[place,power,a,b,c]
 let rows=cards
 rows=link(rows,place,power);rows=link(rows,place,a);rows=link(rows,place,b) // 항구는 3, 가람·나래는 1, 해류술은 1
 expect(defaultAnchor(buildSettingRelationshipMap(rows))).toBe(a.item.id) // 인물 가운데 동률이면 앞선 카드(가람)
 rows=link(rows,b,c);rows=link(rows,c,b) // 나래 3, 다온 2
 expect(defaultAnchor(buildSettingRelationshipMap(rows))).toBe(b.item.id) // 장소(3)와 같은 수여도 인물이 먼저
 expect(defaultAnchor(buildSettingRelationshipMap(cards))).toBe('') // 관계가 하나도 없으면 전체 보기
})

it('인물이 없으면 관계가 가장 많은 카드, 관계가 하나도 없거나 그래프가 비면 빈 문자열(전체 보기)이다',()=>{
 const place=card('location','항구'),power=card('ability','해류술'),rule=card('rule','금지령')
 const rows=putRelation(putRelation([place,power,rule],{subjectId:place.item.id,targetId:power.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'지킨다'}),{subjectId:place.item.id,targetId:rule.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'따른다'})
 expect(defaultAnchor(buildSettingRelationshipMap(rows))).toBe(place.item.id)
 expect(defaultAnchor(buildSettingRelationshipMap([place,power]))).toBe('')
 expect(defaultAnchor(buildSettingRelationshipMap([]))).toBe('')
 expect(defaultAnchor({nodes:[],links:[],missingLinks:0})).toBe('')
})

it('인물이 있어도 인물에게 관계가 하나도 없으면 관계가 가장 많은 다른 카드를 중심으로 삼는다',()=>{
 const a=card('character','가람'),place=card('location','항구'),power=card('ability','해류술')
 const rows=putRelation([a,place,power],{subjectId:place.item.id,targetId:power.item.id,predicate:'custom_relation_directed',polarity:'asserted',text:'지킨다'})
 expect(defaultAnchor(buildSettingRelationshipMap(rows))).toBe(place.item.id)
})

/** 카드 둘이 겹치는지(두 직사각형이 한 축에서라도 떨어져 있으면 겹치지 않는다). */
const overlap=(a:{x:number;y:number},b:{x:number;y:number},w:number,h:number)=>Math.abs(a.x-b.x)<w&&Math.abs(a.y-b.y)<h
it('원형 배치: 중심 카드는 원점 한가운데에, 이웃은 그 둘레에 같은 간격으로 놓이고 어떤 두 카드도 겹치지 않는다 (이웃 1~24장, 카드 크기는 늘 그대로)',()=>{
 for(const count of Array.from({length:24},(_,i)=>i+1)){
  const layout=ringLayout(count,200,150),cards=[layout.center,...layout.ring]
  expect(layout.ring,String(count)).toHaveLength(count)
  expect({x:layout.center.x+100,y:layout.center.y+75},String(count)).toEqual({x:0,y:0}) // 중심 카드의 한가운데가 원점이다
  for(const [i,a] of cards.entries())for(const b of cards.slice(i+1))expect(overlap(a,b,200,150),`${count}장: ${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(false)
  const radii=layout.ring.map(p=>Math.hypot(p.x+100,p.y+75))
  for(const radius of radii)expect(radius).toBeCloseTo(radii[0],6) // 같은 원 위
  expect(radii[0]).toBeGreaterThanOrEqual(260) // 최소 반지름
 }
})

it('원형 배치: 첫 이웃은 중심 바로 위이고 시계 방향으로 간다, 이웃이 없으면 중심 카드만 있다, 화면 크기에 맞춘 배율은 없다(캔버스 확대·축소가 맡는다)',()=>{
 const four=ringLayout(4,200,150)
 expect(four.ring.map(p=>[Math.round(p.x+100),Math.round(p.y+75)])).toEqual([[0,-260],[260,0],[0,260],[-260,0]]) // 위·오른쪽·아래·왼쪽
 expect(ringLayout(0,200,150).ring).toEqual([])
 expect(Object.keys(ringLayout(12,200,150)).sort()).toEqual(['center','ring']) // 보드 폭·높이·배율 같은 화면 크기 값이 없다
})
it('선 라벨의 각도: 선 방향으로 눕히되 글자가 거꾸로 뒤집히지 않게 -90° 초과 90° 이하로 둔다',()=>{
 expect(labelAngle(1,0)).toBeCloseTo(0)
 expect(labelAngle(-1,0)).toBeCloseTo(0) // 왼쪽으로 가는 선도 글자는 왼쪽에서 오른쪽으로 읽힌다
 expect(labelAngle(1,1)).toBeCloseTo(45)
 expect(labelAngle(-1,-1)).toBeCloseTo(45)
 expect(labelAngle(1,-1)).toBeCloseTo(-45)
 expect(labelAngle(-1,1)).toBeCloseTo(-45)
 expect(labelAngle(0,1)).toBeCloseTo(90)
 expect(labelAngle(0,-1)).toBeCloseTo(90) // 위로 가는 선과 아래로 가는 선의 글자 방향이 같다
})
