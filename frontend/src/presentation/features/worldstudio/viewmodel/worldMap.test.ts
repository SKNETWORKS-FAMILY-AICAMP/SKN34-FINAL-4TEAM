import {expect,it} from 'vitest'
import {newSetting} from '../../../../domain/entities/studioWorld'
import {buildWorldMap} from './useWorldMapViewModel'
import {buildCharacterMap} from './characterMap'
import {putRelation} from '../../../../domain/entities/studioRelations'
it('renders only approved data, preserves saved objects and handles an empty world',()=>{
 expect(buildWorldMap([])).toEqual({nodes:[],links:[],missingLinks:0})
 const a=newSetting('people'),b=newSetting('people'),place=newSetting('places')
 a.item.title='가람';b.item.title='나래';place.item.title='도시';a.item.relatedIds=[place.item.id,'missing']
 const rows=putRelation([a,b,place],{subjectId:a.item.id,targetId:b.item.id,predicate:'trusts',polarity:'asserted'})
 const before=structuredClone(rows),map=buildWorldMap(rows)
 expect(map.nodes).toHaveLength(4);expect(map.links).toHaveLength(3);expect(map.missingLinks).toBe(1)
 const people=buildCharacterMap(rows)
 expect(people.nodes).toHaveLength(2);expect(people.links[0]).toMatchObject({source:a.item.id,target:b.item.id,emotion:true,id:rows[3].item.id})
 map.nodes[0].name='canvas mutation';expect(rows).toEqual(before)
 a.item.decision='pending';expect(buildWorldMap([a]).nodes).toHaveLength(0)
})
