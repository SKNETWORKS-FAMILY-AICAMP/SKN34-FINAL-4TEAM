// @vitest-environment jsdom
import {cleanup, render, screen, fireEvent, waitFor} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {WorldPanel} from './WorldPanel'
import {EpisodeUseCase} from '../../../../domain/usecases/EpisodeUseCase'
import {HttpEpisodeRepository} from '../../../../data/content/HttpEpisodeRepository'

afterEach(cleanup)

it('refreshes the selected editor after applying an upstream change',async()=>{
 const value={id:'s',versionId:'v',name:'규칙',content:'분기 내용',category:'규칙',tags:[],visibility:'public',fromEpisode:1,toEpisode:null,knownBy:[],evidence:''}
 const next={...value,versionId:'v2',content:'선택한 원작 정정'}
 const change={id:'c',settingId:'s',before:value,after:next,decision:'pending'}
 const state={id:'w',name:'설정집',revision:0,mode:'independent',basis:null,draft:null,drafts:[],settings:[value],history:[value],changes:[change],sourceToken:'t'}
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(state))).mockResolvedValueOnce(new Response(JSON.stringify({...state,revision:1,settings:[next],history:[value,next],changes:[{...change,decision:'apply'}]})))
 render(<WorldPanel workId="w" useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))} onDirty={()=>{}} />)
 fireEvent.click(await screen.findByRole('button',{name:/규칙.*공개/}))
 fireEvent.click(screen.getByRole('button',{name:'이 원본 변경 반영'}))
 await screen.findByText('원본 변경을 새 설정 버전으로 반영했어요.')
 expect((screen.getByLabelText('설정 내용') as HTMLTextAreaElement).value).toBe('선택한 원작 정정')
})

it('autosaves a private draft then explicitly commits a setting version',async()=>{
 const state={id:'w',name:'설정집',revision:0,mode:'own',basis:null,draft:null,settings:[],history:[],changes:[],sourceToken:'t'}
 const value={id:'s',name:'비마법 규칙',content:'마법은 없다.',category:'규칙',tags:[],visibility:'private',fromEpisode:1,toEpisode:null,knownBy:[],evidence:''}
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(state)))
   .mockResolvedValueOnce(new Response(JSON.stringify({...state,revision:1,draft:value,drafts:[value]})))
   .mockResolvedValueOnce(new Response(JSON.stringify({...state,revision:2,settings:[{...value,versionId:'v'}],history:[{...value,versionId:'v'}]})))
 render(<WorldPanel workId="w" useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))} onDirty={()=>{}} />)
 await screen.findByText('설정집')
 fireEvent.change(screen.getByLabelText('설정 이름'),{target:{value:value.name}})
 fireEvent.change(screen.getByLabelText('설정 내용'),{target:{value:value.content}})
 await screen.findByText('설정 초안 자동저장됨')
 expect(JSON.parse(fetcher.mock.calls[1][1].body).setting.visibility).toBe('private')
 fireEvent.click(screen.getByRole('button',{name:'설정 확정 저장'}))
 await screen.findByText('새 설정 버전으로 확정했어요. 공개 범위는 지정한 회차에만 적용돼요.')
 expect(fetcher.mock.calls[2][0]).toBe('/api/v1/works/w/settings/s/commit')
 await waitFor(()=>expect(screen.getAllByText('비마법 규칙').length).toBeGreaterThan(0))
})

it('shows API failure without claiming a saved draft',async()=>{
 const state={id:'w',name:'설정집',revision:0,mode:'own',basis:null,draft:null,settings:[],history:[],changes:[],sourceToken:'t'}
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(state))).mockResolvedValue(new Response(JSON.stringify({detail:'설정집 충돌'}),{status:409}))
 render(<WorldPanel workId="w" useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))} onDirty={()=>{}} />)
 await screen.findByText('설정집')
 fireEvent.change(screen.getByLabelText('설정 이름'),{target:{value:'규칙'}})
 fireEvent.change(screen.getByLabelText('설정 내용'),{target:{value:'본문'}})
 await screen.findByRole('alert')
 expect(screen.queryByText('설정 초안 자동저장됨')).toBeNull()
})
