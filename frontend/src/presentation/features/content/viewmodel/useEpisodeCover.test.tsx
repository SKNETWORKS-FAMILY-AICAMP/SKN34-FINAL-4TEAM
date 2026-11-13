// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {useEpisodeViewModel} from './useEpisodeViewModel'
import type {EpisodeUseCase} from '../../../../domain/usecases/EpisodeUseCase'

afterEach(cleanup)
it('keeps the created work for a cover retry rather than creating duplicate works on partial failure',async()=>{
 const work={id:'b142427a-cd9d-4fdc-a40d-c9e553d87d30',title:'작품',summary:'',visibility:'private' as const,allowFork:false,allowForkPublication:false,source:null,episodes:[],draft:{title:'새 회차',body:'',revision:0}}
 const api={list:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue(work)}
 const media={upload:vi.fn().mockRejectedValue(new Error('저장소 오류'))}
 const {result}=renderHook(()=>useEpisodeViewModel(null,api as unknown as EpisodeUseCase,media))
 await act(async()=>{})
 let created:string|null=null
 await act(async()=>{created=await result.current.create('작품','',new File(['png'],'표지.png',{type:'image/png'}))})
 // 표지 저장이 실패해도 작품은 만들어졌으므로 id를 돌려줘 화면이 그 작품의 관리 화면으로 가서 표지만 재시도하게 한다.
 expect(created).toBe(work.id)
 expect(result.current.works.map(w=>w.id)).toEqual([work.id])
 expect(result.current.error).toContain('표지')
 expect(api.create).toHaveBeenCalledTimes(1)
 expect(media.upload).toHaveBeenCalledWith({kind:'cover',workId:work.id},expect.any(File),undefined,expect.any(AbortSignal))
})

it('작품 만들기의 실패는 만들기 폼에서 보이도록 자리를 create로 알리고, 작품은 만들어졌는데 표지만 실패하면 화면이 넘어가므로 맨 위 알림으로 돌린다',async()=>{
 const work={id:'b142427a-cd9d-4fdc-a40d-c9e553d87d30',title:'작품',summary:'',visibility:'private' as const,allowFork:false,allowForkPublication:false,source:null,episodes:[],draft:{title:'새 회차',body:'',revision:0}}
 const api={list:vi.fn().mockResolvedValue([]),create:vi.fn().mockRejectedValueOnce(new Error('같은 제목의 작품이 이미 있어요.')).mockResolvedValue(work)}
 const media={upload:vi.fn().mockRejectedValue(new Error('저장소 오류'))}
 const {result}=renderHook(()=>useEpisodeViewModel(null,api as unknown as EpisodeUseCase,media))
 await act(async()=>{})
 await act(async()=>{expect(await result.current.create('작품','')).toBeNull()})
 expect(result.current.error).toBe('같은 제목의 작품이 이미 있어요.')
 expect(result.current.origin).toBe('create')
 await act(async()=>{expect(await result.current.create('작품','',new File(['png'],'표지.png',{type:'image/png'}))).toBe(work.id)})
 expect(result.current.error).toContain('표지')
 expect(result.current.origin).toBe('')
})
