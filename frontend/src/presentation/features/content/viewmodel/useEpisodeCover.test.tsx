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
 const {result}=renderHook(()=>useEpisodeViewModel(api as unknown as EpisodeUseCase,media))
 await act(async()=>{})
 await act(async()=>{await result.current.create('작품','',new File(['png'],'표지.png',{type:'image/png'}))})
 expect(result.current.active?.id).toBe(work.id)
 expect(result.current.error).toContain('표지')
 expect(api.create).toHaveBeenCalledTimes(1)
 expect(media.upload).toHaveBeenCalledWith({kind:'cover',workId:work.id},expect.any(File),undefined,expect.any(AbortSignal))
})
