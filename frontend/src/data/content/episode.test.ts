import { describe, expect, it, vi } from 'vitest'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'

describe('episode API boundary', () => {
  it('does not bind the native fetch function to the repository instance', async () => {
    const fetcher = vi.fn(function(this: unknown) {
      if (this !== undefined) throw new Error('Illegal invocation')
      return Promise.resolve(new Response('[]'))
    })
    await expect(new HttpEpisodeRepository(fetcher).list()).resolves.toEqual([])
  })
  it('rejects malformed server data instead of showing success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'bad' }])))
    await expect(new HttpEpisodeRepository(fetcher).list()).rejects.toThrow('응답')
  })
  it('preserves actionable 409 errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({detail: '최신 원고를 불러와 주세요'}), {status:409}))
    await expect(new HttpEpisodeRepository(fetcher).save('w', {title:'제목',body:'원고',revision:1})).rejects.toThrow('최신 원고')
  })
  it('cannot publish blank text or without rights confirmation', async () => {
    const repo = new HttpEpisodeRepository(vi.fn())
    const send = vi.spyOn(repo, 'publish')
    const useCase = new EpisodeUseCase(repo)
    await expect(useCase.publish('w', {title:'제목',body:' ',revision:1}, true, false)).rejects.toThrow('원고')
    await expect(useCase.publish('w', {title:'제목',body:'본문',revision:1}, false, false)).rejects.toThrow('권리')
    expect(send).not.toHaveBeenCalled()
  })
})

it('public browsing never exposes an editable owner draft', async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify([{id:'p',title:'공개',summary:'',visibility:'public',allowFork:true,allowForkPublication:true,source:null,episodes:[],draft:null}])))
 const rows=await new HttpEpisodeRepository(fetcher).publicList()
 expect(rows[0].readOnly).toBe(true)
 expect(rows[0].draft.body).toBe('')
 expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/works')
})
