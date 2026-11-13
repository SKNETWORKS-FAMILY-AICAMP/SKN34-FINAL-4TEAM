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

it('starts private with no genre, applies a publication change and keeps it when a stale copy is saved',async()=>{
 const repo=new InMemoryWorldStudioRepository(),world=await repo.create('세계','')
 expect(world).toMatchObject({visibility:'private',genre:null})
 const first=await repo.setPublication(world.id,{visibility:'public',genre:'wuxia'})
 expect(first).toMatchObject({worldId:world.id,visibility:'public',genre:'wuxia',listed:false}) // 저장한 적이 없으면 공개여도 목록에 안 나온다
 expect(first.publishedAt).toEqual(expect.any(String))
 const saved=await repo.saveStudio(world) // 공개 설정 전의 편집본이라도 공개 설정을 되돌리지 않는다
 expect(saved).toMatchObject({visibility:'public',genre:'wuxia'})
 expect(await repo.read(world.id)).toMatchObject({visibility:'public',genre:'wuxia'})
 expect((await repo.listStudio()).map(w=>[w.visibility,w.genre])).toEqual([['public','wuxia']])
 expect(await repo.setPublication(world.id,{visibility:'public',genre:'sf'})).toMatchObject({worldId:world.id,visibility:'public',genre:'sf',listed:true}) // 한 번 저장했으니 이제 목록에 나온다
 expect(await repo.setPublication(world.id,{visibility:'private',genre:null})).toEqual({worldId:world.id,visibility:'private',genre:null,publishedAt:null,listed:false})
})
it('rejects a publication change for a world it does not have',async()=>{
 await expect(new InMemoryWorldStudioRepository().setPublication('missing',{visibility:'public',genre:null})).rejects.toThrow(/찾을 수 없습니다/)
})
it('creates at draft version 0 like the server, so a world counts as saved only after its first save',async()=>{
 const repo=new InMemoryWorldStudioRepository(),world=await repo.create('세계','')
 expect(world.version).toBe(0)
 expect((await repo.saveStudio(world)).version).toBe(1)
})
it('keeps character documents across a demo save like the server: only on a character card and only when some document exists',async()=>{
 const repo=new InMemoryWorldStudioRepository(),world=await repo.create('세계','')
 const docs={soul:'말수가 적다',memory:'',episodes:{3:'스승을 잃었다'}}
 const person=newSetting('people'),blank=newSetting('people'),place=newSetting('places')
 person.item.title='가람';blank.item.title='나래';place.item.title='항구'
 world.settings=[{...person,characterDocs:docs},{...blank,characterDocs:{soul:'',memory:'',episodes:{}}},{...place,characterDocs:docs}]
 const saved=await repo.saveStudio(world)
 expect(saved.settings.map(s=>s.characterDocs)).toEqual([docs,undefined,undefined])
 expect(Object.keys(saved.settings[1])).not.toContain('characterDocs')
 expect((await repo.read(world.id)).settings.map(s=>s.characterDocs)).toEqual([docs,undefined,undefined])
 expect(world.settings[2].characterDocs).toEqual(docs) // 받은 편집본은 바꾸지 않는다
})
