import {expect,it} from 'vitest'
import {InMemoryWorldStudioRepository} from './InMemoryWorldStudioRepository'
import {newSetting} from '../../domain/entities/studioWorld'
it('isolates returned values and rejects stale versions without losing saved metadata',async()=>{
 const repo=new InMemoryWorldStudioRepository(),world=await repo.create('세계','')
 const s=newSetting('people');s.item.title='가람';s.tags=['태그'];s.aliases=['별칭'];world.settings=[s]
 const saved=await repo.saveStudio(world)
 saved.settings[0].tags.push('외부 변경')
 expect((await repo.read(world.id)).settings[0].tags).toEqual(['태그'])
 await expect(repo.saveStudio(world)).rejects.toThrow(/다른 변경/)
 expect((await repo.read(world.id)).settings[0].aliases).toEqual(['별칭'])
})
