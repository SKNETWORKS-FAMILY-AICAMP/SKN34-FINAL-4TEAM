import {expect,it} from 'vitest'
import {newSetting} from './studioWorld'
import {cardTypes,cardTypeOf,cardTypePatch,areaPatch,storageLimitations} from './studioCards'
it('separates eight card types from areas without rewriting legacy items',()=>{
 expect(cardTypes.map(t=>t.id)).toEqual(['character','location','organization','ability','object','rule','event','other'])
 const s=newSetting('people');s.item.category='society';s.item.text='원문';s.tags=['주인공']
 const before=structuredClone(s)
 expect(cardTypeOf(s.item)).toBe('character');expect(areaPatch(s.item,'culture')).toEqual({category:'culture'});expect(s).toEqual(before)
 expect(cardTypeOf({...s.item,entityType:'unknown'})).toBe('review')
 expect(cardTypeOf({...s.item,entityType:'rule'})).toBe('review')
 expect(cardTypeOf({...s.item,kind:'relation',entityType:null})).toBe('relation')
})
it('protects existing links and semantic fields when classification changes',()=>{
 const s=newSetting('people'),r=newSetting();r.item.kind='relation';r.item.subjectId=s.item.id
 expect(()=>cardTypePatch(s.item,'location',[s,r])).toThrow(/연결/)
 expect(()=>cardTypePatch({...s.item,kind:'claim',entityType:null},'character',[s])).toThrow(/의미/)
 expect(()=>areaPatch({...s.item,kind:'event',category:'history'},'space')).toThrow(/역사/)
 expect(()=>areaPatch({...s.item,topics:['basic.era']},'space')).toThrow(/분석/)
})
it('blocks unsupported object and alias fields before HTTP persistence',()=>{
 const s=newSetting('people')
 expect(storageLimitations([s])).toEqual([])
 expect(storageLimitations([{...s,item:{...s.item,entityType:'object'}}]).join(' ')).toMatch(/사물/)
 expect(storageLimitations([{...s,aliases:['길동']}]).join(' ')).toMatch(/별칭/)
 expect(cardTypePatch(s.item,'organization',[s])).toMatchObject({kind:'entity',entityType:'organization'})
})

it('retains fact, claim, undetermined and relation identities without coercing them to other',()=>{
 const s=newSetting();const before=structuredClone(s)
 for(const kind of ['fact','claim','undetermined'] as const){const item={...s.item,kind};expect(cardTypeOf(item)).toBe('review');expect(item.kind).toBe(kind)}
 expect(cardTypeOf({...s.item,kind:'relation'})).toBe('relation');expect(s).toEqual(before)
 expect(()=>cardTypePatch(s.item,'other',[s])).toThrow(/Core/)
 expect(()=>cardTypePatch(s.item,'object',[s])).toThrow(/Core/)
})
