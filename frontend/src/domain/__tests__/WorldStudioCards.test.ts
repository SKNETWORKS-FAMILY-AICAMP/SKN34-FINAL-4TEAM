import {expect,it,vi} from 'vitest'
import {newSetting,studioLabelCleanup} from '../entities/studioWorld'
import {editStudioSetting,putRelation} from '../entities/studioRelations'
import {cardTypes,cardTypePatch,cardTypeOf,settingAreas,areaPatch} from '../entities/studioCards'
import {worldWritingIssues} from '../entities/worldStudioWriting'
import {WorldStudioUseCase} from '../usecases/WorldStudioUseCase'
import type {WorldStudioRepository} from '../repositories/WorldStudioRepository'
import type {StudioWorld} from '../entities/studioWorld'
function fakeRepository():WorldStudioRepository {
 let world:StudioWorld
 return {listStudio:async()=>[world],read:async()=>world,create:async(name,description)=>(world={id:'fake',name,description,version:1,settings:[],analysis:null}),saveStudio:async next=>(world=next),setPublication:async(worldId,publication)=>({worldId,...publication,publishedAt:null,listed:false})}
}
it('preserves all eight types, seven areas and author metadata in demo saves',async()=>{
 const useCase=new WorldStudioUseCase(fakeRepository())
 const world=await useCase.create('세계','설명')
 world.settings=cardTypes.map(({id})=>{const s=newSetting();Object.assign(s.item,cardTypePatch(s.item,id,[]));s.item.title=id;s.item.text='설명';s.aliases=['별칭'];s.tags=['태그'];s.userCategory='분류';s.item.condition='조건';return s})
 const saved=await useCase.save(world)
 expect(saved.settings.map(s=>cardTypeOf(s.item))).toEqual(cardTypes.map(t=>t.id))
 expect(saved.settings).toEqual(world.settings)
 expect(settingAreas).toHaveLength(7)
 for(const {id} of settingAreas)expect(areaPatch(newSetting().item,id)).toEqual({category:id})
})
it('rejects invalid names without overwriting a saved world',async()=>{
 const useCase=new WorldStudioUseCase(fakeRepository())
 const w=await useCase.create('원본','')
 await expect(useCase.save({...w,name:' '})).rejects.toThrow()
 expect((await useCase.read(w.id)).name).toBe('원본')
})

it('rejects a reader reveal episode that is not an integer of 1 or more without overwriting a saved world',async()=>{
 const repository=fakeRepository(),useCase=new WorldStudioUseCase(repository)
 const card=newSetting('people');card.item.title='가람'
 const saved=await useCase.save({...await useCase.create('세계',''),settings:[{...card,revealFromEpisode:3}]})
 expect(saved.settings[0].revealFromEpisode).toBe(3)
 const save=vi.spyOn(repository,'saveStudio')
 for(const revealFromEpisode of [0,-2,1.5])await expect(useCase.save({...saved,settings:[{...card,revealFromEpisode}]})).rejects.toThrow('독자 공개 회차는 1 이상의 정수로 입력해 주세요.')
 expect(save).not.toHaveBeenCalled()
 expect((await useCase.read(saved.id)).settings[0].revealFromEpisode).toBe(3)
})

it('rejects a character document over 3,000 characters or with a malformed episode number, with the same message as the pre-save check and without overwriting a saved world',async()=>{
 const repository=fakeRepository(),useCase=new WorldStudioUseCase(repository)
 const card=newSetting('people');card.item.title='가람';card.item.text='본문'
 const docs=(memory:string,episodes:Record<string,string>={})=>({...card,characterDocs:{soul:'성격',memory,episodes}})
 const saved=await useCase.save({...await useCase.create('세계',''),settings:[docs('가'.repeat(3000),{3:'기억'})]})
 expect(saved.settings[0].characterDocs).toEqual({soul:'성격',memory:'가'.repeat(3000),episodes:{3:'기억'}})
 const save=vi.spyOn(repository,'saveStudio')
 const longBody={...card,item:{...card.item,text:'가'.repeat(3001)}} // 인물 카드의 본문은 IDENTITY.md 문서다
 for(const [row,message] of [[docs('가'.repeat(3001)),'MEMORY.md는 3,000자 이하로 줄여 주세요.'],[docs('',{12:'가'.repeat(3001)}),'memory/12회차.md는 3,000자 이하로 줄여 주세요.'],[docs('',{'-1':'기억'}),'회차 기억의 회차 번호는 0 이상의 정수로 입력해 주세요.'],[longBody,'IDENTITY.md는 3,000자 이하로 줄여 주세요.']] as const){
  await expect(useCase.save({...saved,settings:[row]})).rejects.toThrow(message)
  expect(worldWritingIssues({...saved,settings:[row]}).map(issue=>issue.message)).toEqual([message])
 }
 expect(save).not.toHaveBeenCalled()
 expect((await useCase.read(saved.id)).settings[0].characterDocs?.memory).toHaveLength(3000)
 const place={...newSetting('places'),characterDocs:{soul:'가'.repeat(3001),memory:'',episodes:{}}};place.item.title='항구' // 인물이 아닌 카드의 문서는 저장하지 않으므로 막지 않는다
 await expect(useCase.save({...saved,settings:[place]})).resolves.toBeTruthy()
 place.item.text='가'.repeat(3001) // 인물이 아닌 카드의 본문 길이는 기존 문구 그대로 막는다
 await expect(useCase.save({...saved,settings:[place]})).rejects.toThrow('설정 이름과 설명의 길이를 확인해 주세요.')
})

it.each([
 ['targetId',null],['targetId',''],['targetId',' \t\n '],
 ['subjectId',null],['subjectId',''],['subjectId',' \t\n '],
] as const)('rejects blank relationship %s (%j) without losing saved links or the draft',async(field,value)=>{
 const repository=fakeRepository(),useCase=new WorldStudioUseCase(repository)
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('people')
 a.item.title='가람';b.item.title='나래';c.item.title='다온'
 const world=await useCase.create('세계','')
 const saved=await useCase.save({...world,settings:putRelation([a,b,c],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})})
 const before=structuredClone(saved),relation=saved.settings[3].item
 const draft={...saved,settings:editStudioSetting(saved.settings,relation.id,{[field]:value})}
 const save=vi.spyOn(repository,'saveStudio')
 await expect(useCase.save(draft)).rejects.toThrow('관계 주체와 대상을 선택해 주세요.')
 expect(save).not.toHaveBeenCalled()
 expect(await useCase.read(saved.id)).toEqual(before)
 expect(draft.settings[3].item[field]).toBe(value)
 const corrected={...draft,settings:editStudioSetting(draft.settings,relation.id,{[field]:c.item.id})}
 const result=await useCase.save(corrected)
 expect(save).toHaveBeenCalledTimes(1)
 expect(result.settings[3].item).toMatchObject({id:relation.id,subjectId:a.item.id,targetId:b.item.id,[field]:c.item.id})
 expect(await useCase.read(saved.id)).toEqual(corrected)
})

it('passes mutation cancellation through the use case without changing its input',async()=>{
 const repository=fakeRepository(),useCase=new WorldStudioUseCase(repository),controller=new AbortController()
 const create=vi.spyOn(repository,'create'),save=vi.spyOn(repository,'saveStudio')
 const world=await useCase.create('세계','',controller.signal)
 await useCase.save(world,controller.signal)
 expect(create).toHaveBeenCalledWith('세계','',controller.signal)
 expect(save).toHaveBeenCalledWith(world,controller.signal,undefined)
})

it('only requests label cleanup when trimming or removing empty labels changes the value',()=>{
 expect(studioLabelCleanup(undefined)).toBeUndefined()
 expect(studioLabelCleanup([])).toBeUndefined()
 expect(studioLabelCleanup(['금빛 열쇠','보물'])).toBeUndefined()
 expect(studioLabelCleanup([' 금빛 열쇠 ','','보물'])).toEqual(['금빛 열쇠','보물'])
 expect(studioLabelCleanup([' ',''])).toEqual([])
})

it('passes the publication change and its cancellation through the use case',async()=>{
 const repository=fakeRepository(),useCase=new WorldStudioUseCase(repository),controller=new AbortController()
 const set=vi.spyOn(repository,'setPublication')
 const result=await useCase.setPublication('fake',{visibility:'public',genre:'sf'},controller.signal)
 expect(set).toHaveBeenCalledWith('fake',{visibility:'public',genre:'sf'},controller.signal)
 expect(result).toMatchObject({worldId:'fake',visibility:'public',genre:'sf'})
})
