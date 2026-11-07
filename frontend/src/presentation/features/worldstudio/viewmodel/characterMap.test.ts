import {expect,it} from 'vitest'
import {newSetting} from '../../../../domain/entities/studioWorld'
import {putRelation} from '../../../../domain/entities/studioRelations'
import {mapConnectionLabel,type MapNode} from './useWorldMapViewModel'
import {buildCharacterMap} from './characterMap'
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
