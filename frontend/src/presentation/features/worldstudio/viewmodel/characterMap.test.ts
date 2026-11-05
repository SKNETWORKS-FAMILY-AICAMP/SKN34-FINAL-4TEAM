import {expect,it} from 'vitest'
import {newSetting} from '../../../../domain/entities/studioWorld'
import {putRelation} from '../../../../domain/entities/studioRelations'
import {mapConnectionLabel,type MapNode} from './useWorldMapViewModel'
import {buildCharacterMap} from './characterMap'
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
 const a=newSetting('people'),b=newSetting('people'),description='오랫동안 바다를 함께 건너온 이들을 신뢰한다'
 const rows=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'trusts',polarity:'asserted',text:description})
 const link=buildCharacterMap(rows).links[0]
 expect(link.label).toBe('신뢰')
 expect(mapConnectionLabel(link,a.item.id)).toBe('보내는 관계 · 신뢰 · '+description)
 expect(mapConnectionLabel(link,b.item.id)).toBe('받는 관계 · 신뢰 · '+description)
})
