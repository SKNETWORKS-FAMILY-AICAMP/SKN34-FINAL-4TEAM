import { expect,it } from 'vitest'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { buildCharacterMap } from './characterMap'
it('projects relationship records as selectable edges without mutating settings',()=>{
 const a=newSetting('people'),b=newSetting('people');a.item.title='가람';b.item.title='나래'
 const settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'hostile_to',polarity:'denied'})
 const before=structuredClone(settings),graph=buildCharacterMap(settings)
 expect(graph.nodes.map(n=>n.id)).toEqual([a.item.id,b.item.id])
 expect(graph.links[0]).toMatchObject({id:settings[2].item.id,source:a.item.id,target:b.item.id,label:'적대 아님'})
 graph.nodes[0].x=23;graph.links[0].source=graph.nodes[0]
 expect(settings).toEqual(before)
})
