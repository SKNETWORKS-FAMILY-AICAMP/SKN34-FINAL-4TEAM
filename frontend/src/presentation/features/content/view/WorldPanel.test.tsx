// @vitest-environment jsdom
import {cleanup, render, screen, fireEvent, within} from '@testing-library/react'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import '../../../../test/testLocks'
import {WorldPanel} from './WorldPanel'
import {EpisodeUseCase} from '../../../../domain/usecases/EpisodeUseCase'
import {HttpEpisodeRepository} from '../../../../data/content/HttpEpisodeRepository'
import {login} from '../../../../data/api/auth'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'content-csrf' })
    : Response.json({ accessToken: 'content-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const world=(over:object={})=>({id:'w',name:'설정집',revision:0,mode:'own',basis:null,draft:null,drafts:[],settings:[],history:[],changes:[],sourceToken:'t',...over})
const setting={id:'s',versionId:'v',name:'지도',content:'설정',category:'장소',tags:[],visibility:'private',fromEpisode:1,toEpisode:null,knownBy:[],evidence:''}
const show=(fetcher:typeof fetch)=>render(<WorldPanel workId="w" useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))} />)

it('shows only the settings book summary and no coming-soon studio button now that world linking has its own panel',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(world({name:'구운몽 설정집',mode:'following',basis:{episode:2,version:1,settings:[setting,setting]},settings:[setting],history:[setting]})))
 show(fetcher)
 const card=await screen.findByRole('region',{name:'세계관 설정집'})
 expect(within(card).getByRole('heading',{name:'구운몽 설정집'})).toBeTruthy()
 expect(within(card).getByText('원작 추종 중 · 첫 설정 수정 시 전체 공개 설정이 독립해요.')).toBeTruthy()
 expect(within(card).getByText('최초 분기 기준: 2화 · 원고 버전 1 · 설정 2개')).toBeTruthy()
 // 내 세계관과의 연결은 같은 탭의 '세계관 연결' 카드(LinkedWorldPanel)가 맡으므로 '연결 예정' 자리표시는 없다.
 expect(within(card).queryByRole('button')).toBeNull()
 expect(screen.queryByText('연결 예정')).toBeNull()
 // 설정 항목 목록·작성 폼·새로고침은 이 탭에 없다.
 for(const name of ['새 설정 항목','설정집 새로고침','설정 초안 저장','설정 확정 저장'])expect(screen.queryByRole('button',{name})).toBeNull()
 for(const label of ['설정 이름','설정 내용'])expect(screen.queryByLabelText(label)).toBeNull()
 expect(screen.queryByText(/설정 항목/)).toBeNull()
 expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each([
 ['independent','독립 세계관 · 원작 변경은 선택해서 반영해요.'],
 ['own','내 작품의 세계관 · 확정 설정만 문맥에 사용해요.'],
] as const)('describes a %s settings book and shows no first-fork basis when it has none',async(mode,text)=>{
 show(vi.fn().mockResolvedValueOnce(Response.json(world({mode}))))
 await screen.findByText(text)
 expect(screen.queryByText(/최초 분기 기준/)).toBeNull()
})

it('shows a load failure as an alert and reads the settings book again only from the retry button',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({detail:'설정집을 불러오지 못했어요.'},{status:500})).mockResolvedValueOnce(Response.json(world()))
 show(fetcher)
 expect((await screen.findByRole('alert')).textContent).toBe('설정집을 불러오지 못했어요.')
 fireEvent.click(screen.getByRole('button',{name:'설정집 다시 불러오기'}))
 await screen.findByRole('region',{name:'세계관 설정집'})
 expect(screen.queryByRole('alert')).toBeNull()
 expect(fetcher).toHaveBeenCalledTimes(2)
})
