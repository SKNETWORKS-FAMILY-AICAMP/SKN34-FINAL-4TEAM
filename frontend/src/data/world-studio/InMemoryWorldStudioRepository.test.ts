import {expect,it} from 'vitest'
import {InMemoryWorldStudioRepository} from './InMemoryWorldStudioRepository'
import {newSetting,type CharacterDocs} from '../../domain/entities/studioWorld'
import type {WorldStudioRepository} from '../../domain/repositories/WorldStudioRepository'
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
 const docs={soul:'말수가 적다',goal:'스승의 원수를 찾는다',episodes:{3:'스승을 잃었다'}}
 const person=newSetting('people'),blank=newSetting('people'),place=newSetting('places')
 person.item.title='가람';blank.item.title='나래';place.item.title='항구'
 world.settings=[{...person,characterDocs:docs},{...blank,characterDocs:{soul:'',goal:'',episodes:{}}},{...place,characterDocs:docs}]
 const saved=await repo.saveStudio(world)
 expect(saved.settings.map(s=>s.characterDocs)).toEqual([docs,undefined,undefined])
 expect(Object.keys(saved.settings[1])).not.toContain('characterDocs')
 expect((await repo.read(world.id)).settings.map(s=>s.characterDocs)).toEqual([docs,undefined,undefined])
 expect(world.settings[2].characterDocs).toEqual(docs) // 받은 편집본은 바꾸지 않는다
})
it('stores a document that still has the pre-GOAL.md memory text without the memory key, merged into 00회차 (the same rule the server read uses)',async()=>{
 const repo=new InMemoryWorldStudioRepository(),world=await repo.create('세계','')
 const person=newSetting('people');person.item.title='가람'
 const old={soul:'',memory:'스승의 유언',episodes:{0:'프롤로그의 기억'}} as unknown as CharacterDocs
 world.settings=[{...person,characterDocs:old}]
 const [saved]=(await repo.saveStudio(world)).settings
 expect(saved.characterDocs).toEqual({soul:'',goal:'',episodes:{0:'스승의 유언\n\n프롤로그의 기억'}})
 expect(saved.characterDocs).not.toHaveProperty('memory')
 expect((await repo.read(world.id)).settings[0].characterDocs).toEqual(saved.characterDocs)
})
it('does not read or save relations per episode, so the demo locks the relation episode picker',()=>{
 const repository:WorldStudioRepository=new InMemoryWorldStudioRepository()
 expect(repository.relationEpisodes).toBeUndefined()
})
it('deletes a world from memory so the list and a read no longer have it, and reports a world it does not have',async()=>{
 const repo=new InMemoryWorldStudioRepository(),world=await repo.create('세계',''),keep=await repo.create('남길 세계','')
 await expect(repo.deleteStudio(world.id)).resolves.toBeUndefined()
 expect((await repo.listStudio()).map(w=>w.id)).toEqual([keep.id])
 await expect(repo.read(world.id)).rejects.toThrow(/찾을 수 없습니다/)
 await expect(repo.deleteStudio(world.id)).rejects.toThrow(/찾을 수 없습니다/)
})
it('has no confirmed versions to restore: the demo does not read, confirm or restore revisions',()=>{
 const repository:WorldStudioRepository=new InMemoryWorldStudioRepository()
 expect([repository.revisions,repository.confirm,repository.restoreRevision]).toEqual([undefined,undefined,undefined])
})
