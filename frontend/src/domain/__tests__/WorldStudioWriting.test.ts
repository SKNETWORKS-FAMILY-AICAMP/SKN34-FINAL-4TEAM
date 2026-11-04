import {buildCharacterMap} from '../../presentation/features/worldstudio/viewmodel/characterMap'
import {putRelation} from '../entities/studioRelations'
import {expect,it} from 'vitest'
import {cardLibraryRows,worldWritingIssues} from '../entities/worldStudioWriting'
import {newSetting,type StudioWorld} from '../entities/studioWorld'
import {initialWorldStudioFlow,worldStudioFlow} from '../../presentation/features/worldstudio/viewmodel/worldStudioFlow'
const world=(settings:StudioWorld['settings']=[]):StudioWorld=>({id:'qa',name:'초기 세계',description:'',version:1,settings,analysis:null})
it('shows ordinary card types separately from legacy relations and unclassified settings without changing them',()=>{
 const person=newSetting('people');person.item.title='가람';person.tags=['주인공'];person.aliases=['여행자']
 const fact=newSetting();fact.item.title='기존 사실';fact.item.text='원문';const relation={...newSetting(),item:{...newSetting().item,kind:'relation' as const}}
 const settings=[person,fact,relation],before=structuredClone(settings)
 expect(cardLibraryRows(settings,'all','')).toEqual([person])
 expect(cardLibraryRows(settings,'character','여행자')).toEqual([person])
 expect(cardLibraryRows(settings,'location','')).toEqual([])
 expect(settings).toEqual(before)
})
it('keeps object and other card identities visible without coercing unsupported types',()=>{
 const object=newSetting('people');object.item.entityType='object'
 const other={...newSetting('people'),item:{...newSetting('people').item,entityType:'other'}}
 expect(cardLibraryRows([object,other],'object','')).toEqual([object])
 expect(cardLibraryRows([object,other],'all','')).toEqual([object,other])
})
it('does not require optional descriptions or relationships and points missing names back to their exact card',()=>{
 expect(worldWritingIssues(world())).toEqual([])
 const person=newSetting('people');person.item.title='가람'
 expect(worldWritingIssues(world([person]))).toEqual([])
 const blank=newSetting('places')
 expect(worldWritingIssues(world([blank]))).toContainEqual({step:'cards',id:blank.item.id,message:'카드 이름을 입력해 주세요.'})
 expect(worldWritingIssues({...world(),name:' '})).toContainEqual({step:'info',message:'세계관 이름을 입력해 주세요.'})
 const fact=newSetting();fact.item.title='기존 규칙'
 expect(worldWritingIssues(world([fact]))).toContainEqual({step:'cards',id:fact.item.id,message:'이 설정의 설명을 입력해 주세요.'})
})
it('keeps the authoring step through the separate library and can skip relationships',()=>{
 const cards=worldStudioFlow(initialWorldStudioFlow,{type:'step',step:'cards'})
 const library=worldStudioFlow(cards,{type:'list'})
 expect(worldStudioFlow(library,{type:'resume'})).toEqual(cards)
 expect(worldStudioFlow(cards,{type:'step',step:'review'})).toEqual({screen:'editor',step:'review'})
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
