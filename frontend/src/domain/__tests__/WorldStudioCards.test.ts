import {expect,it,vi} from 'vitest'
import {newSetting,studioLabelCleanup} from '../entities/studioWorld'
import {editStudioSetting,putRelation} from '../entities/studioRelations'
import {cardTypes,cardTypePatch,cardTypeOf,settingAreas,areaPatch} from '../entities/studioCards'
import {WorldStudioUseCase} from '../usecases/WorldStudioUseCase'
import type {WorldStudioRepository} from '../repositories/WorldStudioRepository'
import type {StudioWorld} from '../entities/studioWorld'
function fakeRepository():WorldStudioRepository {
 let world:StudioWorld
 return {listStudio:async()=>[world],read:async()=>world,create:async(name,description)=>(world={id:'fake',name,description,version:1,settings:[],analysis:null}),saveStudio:async next=>(world=next)}
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
 expect(save).toHaveBeenCalledWith(world,controller.signal)
})

it('only requests label cleanup when trimming or removing empty labels changes the value',()=>{
 expect(studioLabelCleanup(undefined)).toBeUndefined()
 expect(studioLabelCleanup([])).toBeUndefined()
 expect(studioLabelCleanup(['금빛 열쇠','보물'])).toBeUndefined()
 expect(studioLabelCleanup([' 금빛 열쇠 ','','보물'])).toEqual(['금빛 열쇠','보물'])
 expect(studioLabelCleanup([' ',''])).toEqual([])
})
