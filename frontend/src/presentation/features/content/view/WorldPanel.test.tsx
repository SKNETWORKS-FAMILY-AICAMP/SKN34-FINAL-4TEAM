// @vitest-environment jsdom
import {cleanup, render, screen, fireEvent, within} from '@testing-library/react'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import '../../../../test/testLocks'
import {WorldPanel} from './WorldPanel'

// 첨부 패널은 자기 테스트(MediaPanel.test)가 맡는다. 여기서는 어떤 설정의 패널이 어떤 잠금으로 붙는지만 본다.
vi.mock('../../../shared/media/MediaPanel',()=>({MediaPanel:({target,disabled}:{target:object;disabled?:boolean})=><p data-testid="media-panel">{JSON.stringify(target)+(disabled?' 잠김':'')}</p>}))
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
const show=(fetcher:typeof fetch,props:{locked?:boolean}={})=>render(<WorldPanel workId="w" useCase={new EpisodeUseCase(new HttpEpisodeRepository(fetcher))} {...props} />)

it('shows only the settings book summary and no coming-soon studio button now that world linking has its own panel',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(world({name:'구운몽 설정집',mode:'following',basis:{episode:2,version:1,settings:[setting,setting]},settings:[setting],history:[setting]})))
 show(fetcher)
 // 구역 이름은 화면에 보이는 제목(h3)이다(aria-label이 아니라 aria-labelledby).
 const card=await screen.findByRole('region',{name:'구운몽 설정집'})
 // 같은 탭의 연결·원고로 세계관 만들기 구획과 같은 카드(tcard ep-card)다.
 expect([...card.classList]).toEqual(expect.arrayContaining(['tcard','ep-card']))
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
 ['independent','독립 세계관 · 원작이 바뀌어도 따라오지 않아요.'],
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
 // 불러오는 중·실패 구획도 카드다(읽은 뒤 설정집 카드로 바뀌어도 모양이 같다).
 expect([...screen.getByRole('alert').closest('section')!.classList]).toEqual(expect.arrayContaining(['tcard','ep-card']))
 fireEvent.click(screen.getByRole('button',{name:'설정집 다시 불러오기'}))
 await screen.findByRole('region',{name:'설정집'})
 expect(screen.queryByRole('alert')).toBeNull()
 expect(fetcher).toHaveBeenCalledTimes(2)
})

const panelOf=(workId:string,settingId:string)=>JSON.stringify({kind:'setting',workId,settingId})

it('내 설정집은 설정 하나를 골라 그 설정의 첨부 패널(참고 파일·설정 이미지)을 붙이고, 고르면 그 설정의 패널로 바뀐다',async()=>{
 const second={...setting,id:'s2',versionId:'v2',name:'인물 표'}
 const draftOnly={id:'d',name:'초안 설정',content:'초안',category:'장소',tags:[],visibility:'private',fromEpisode:1,toEpisode:null,knownBy:[],evidence:''}
 show(vi.fn().mockResolvedValueOnce(Response.json(world({settings:[setting,second],drafts:[draftOnly]}))))
 const filesRegion=await screen.findByRole('region',{name:'설정 첨부'})
 expect([...filesRegion.classList]).toEqual(expect.arrayContaining(['tcard','ep-card']))
 const files=within(filesRegion)
 const select=files.getByRole<HTMLSelectElement>('combobox',{name:'첨부할 설정'})
 expect(Array.from(select.options,option=>option.textContent)).toEqual(['지도','인물 표','초안 설정'])
 expect(files.getByTestId('media-panel').textContent).toBe(panelOf('w','s'))
 fireEvent.change(select,{target:{value:'d'}})
 expect(files.getByTestId('media-panel').textContent).toBe(panelOf('w','d'))
})

it('설정집을 읽는 요청이 진행 중이면 첨부 패널도 잠근다',async()=>{
 show(vi.fn().mockResolvedValueOnce(Response.json(world({settings:[setting]}))),{locked:true})
 expect((await screen.findByTestId('media-panel')).textContent).toBe(panelOf('w','s')+' 잠김')
 expect((screen.getByRole('combobox',{name:'첨부할 설정'}) as HTMLSelectElement).disabled).toBe(true)
})

it('원작을 따라가는 설정집은 첨부할 수 없는 이유를 알리고 패널을 붙이지 않는다',async()=>{
 show(vi.fn().mockResolvedValueOnce(Response.json(world({mode:'following',settings:[setting]}))))
 const files=within(await screen.findByRole('region',{name:'설정 첨부'}))
 expect(files.getByText('원작을 따라가는 설정에는 파일을 붙일 수 없어요.')).toBeTruthy()
 expect(files.queryByTestId('media-panel')).toBeNull()
 expect(files.queryByRole('combobox')).toBeNull()
})

it('첨부할 설정이 없는 설정집은 빈 상태를 알리고 패널을 붙이지 않는다',async()=>{
 show(vi.fn().mockResolvedValueOnce(Response.json(world())))
 const files=within(await screen.findByRole('region',{name:'설정 첨부'}))
 expect(files.getByText('첨부할 설정이 아직 없어요.')).toBeTruthy()
 expect(files.queryByTestId('media-panel')).toBeNull()
})
it('설정집 카드와 설정 첨부 카드의 구역 이름은 화면에 보이는 제목(h3)이고, 첨부 카드의 제목은 설정 첨부 하나다',async()=>{
 show(vi.fn().mockResolvedValueOnce(Response.json(world({name:'구운몽 설정집',settings:[setting]}))))
 const book=await screen.findByRole('region',{name:'구운몽 설정집'})
 expect(book.getAttribute('aria-labelledby')).toBe(within(book).getByRole('heading',{level:3,name:'구운몽 설정집'}).id)
 const files=screen.getByRole('region',{name:'설정 첨부'})
 expect(files.getAttribute('aria-labelledby')).toBe(within(files).getByRole('heading',{level:3,name:'설정 첨부'}).id)
 expect(screen.queryByRole('heading',{name:'설정 첨부 파일'})).toBeNull()
})
