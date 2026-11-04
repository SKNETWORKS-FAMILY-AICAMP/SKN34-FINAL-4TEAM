import {expect,it} from 'vitest'
import {newSetting} from '../entities/studioWorld'
import {cardTypes,cardTypePatch,cardTypeOf,settingAreas,areaPatch} from '../entities/studioCards'
import {WorldStudioUseCase} from '../usecases/WorldStudioUseCase'
import {InMemoryWorldStudioRepository} from '../../data/world-studio/InMemoryWorldStudioRepository'
it('preserves all eight types, seven areas and author metadata in demo saves',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계','설명')
 world.settings=cardTypes.map(({id})=>{const s=newSetting();Object.assign(s.item,cardTypePatch(s.item,id,[]));s.item.title=id;s.item.text='설명';s.aliases=['별칭'];s.tags=['태그'];s.userCategory='분류';s.item.condition='조건';return s})
 const saved=await useCase.save(world)
 expect(saved.settings.map(s=>cardTypeOf(s.item))).toEqual(cardTypes.map(t=>t.id))
 expect(saved.settings).toEqual(world.settings)
 saved.settings[0].tags.push('외부 변경')
 expect((await useCase.read(world.id)).settings[0].tags).toEqual(['태그'])
 expect(settingAreas).toHaveLength(7)
 for(const {id} of settingAreas)expect(areaPatch(newSetting().item,id)).toEqual({category:id})
})
it('rejects invalid names without overwriting a saved world',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const w=await useCase.create('원본','')
 await expect(useCase.save({...w,name:' '})).rejects.toThrow()
 expect((await useCase.read(w.id)).name).toBe('원본')
})
