import { expect, it, vi } from 'vitest'
import { HttpWorldStudioRepository } from './HttpWorldStudioRepository'

it('calls the browser fetch with its required Window receiver', async () => {
  const fetcher:typeof fetch=async function(this:unknown) {
    if(this!==globalThis) throw new TypeError('Illegal invocation')
    return new Response('[]')
  }
  expect(await new HttpWorldStudioRepository(fetcher).list()).toEqual([])
})

it('reads confirmed settings from Core rather than browser memory', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'world-a', name: '항구', description: '', version: 2, settings: [], analysis: null }])))
  const repo = new HttpWorldStudioRepository(fetcher)
  expect((await repo.list())[0]).toMatchObject({ id: 'world-a', name: '항구', public: false })
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/studio/worlds')
})

it('keeps validation and conflict failures as errors', async () => {
  const repo = new HttpWorldStudioRepository(vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '다른 곳에서 변경되었습니다' }), { status: 409 })))
  await expect(repo.read('world-a')).rejects.toThrow('다른 곳에서 변경되었습니다')
})

it('rejects malformed server data', async () => {
  const repo = new HttpWorldStudioRepository(vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'world-a' }]))))
  await expect(repo.list()).rejects.toThrow()
})

it('explains a missing world in the current environment and points back to the world list',async()=>{
 const repo=new HttpWorldStudioRepository(vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'Not Found'}),{status:404})))
 await expect(repo.read('qa-only-world')).rejects.toThrow('이 환경에서 세계관을 찾을 수 없습니다. 세계관 작업실로 돌아가 목록에서 선택하거나 새로 만들어 주세요.')
})

it('preserves unexpected alias data on read and refuses to submit it to the legacy writer',async()=>{
 const {newSetting}=await import('../../domain/entities/studioWorld')
 const {WorldStudioUseCase}=await import('../../domain/usecases/WorldStudioUseCase')
 const s={...newSetting('people'),aliases:['길동']};s.item.title='홍길동'
 const world={id:'aliases',name:'별칭 보존',description:'',version:1,settings:[s],analysis:null}
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(world)))
 const repo=new HttpWorldStudioRepository(fetcher);const loaded=await repo.read('aliases')
 expect(loaded.settings[0].aliases).toEqual(['길동'])
 await expect(new WorldStudioUseCase(repo).save(loaded)).rejects.toThrow(/별칭/)
 expect(fetcher).toHaveBeenCalledTimes(1)
})
