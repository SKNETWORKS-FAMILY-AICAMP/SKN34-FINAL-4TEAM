// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import type {ComponentProps} from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {Link,Route,RouterProvider,Routes,createMemoryRouter,useLocation,useNavigate} from 'react-router'
import {Provider} from 'react-redux'
import {appContainer} from '../../app/appContainer'
import {createAppStore} from '../../app/store'
import '../reactFlowStubs'
import {WorldStudioPage} from '../../presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioLeaveProvider} from '../../presentation/features/worldstudio/viewmodel/WorldStudioLeaveProvider'
import {WorldStudioUseCase} from '../../domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from '../../domain/entities/studioWorld'
/** 게시판 제목은 미리보기를 열고 `수정하기`가 편집 화면을 연다. 이미 미리보기가 열려 있으면(편집 화면에 다녀온 뒤) 제목을 다시 누르지 않는다(접힌다). */
const openCard=(name:string)=>{const title=screen.getByRole('button',{name});if(title.getAttribute('aria-expanded')!=='true')fireEvent.click(title);fireEvent.click(screen.getByRole('button',{name:'수정하기'}))}
let useCase:WorldStudioUseCase
let createWorld=vi.fn(async(_name:string,_description:string):Promise<StudioWorld>=>{throw new Error('test setup')})
vi.mock('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>actual.useWorldStudioViewModel(useCase)}
})
// 카드 설명 편집기(Toast UI Editor)는 jsdom에서 입력을 흉내 낼 수 없어 같은 값 전달만 하는 textarea 대역을 쓴다.
vi.mock('../../presentation/shared/LazyMarkdownEditor',()=>import('../markdownEditorFake'))
// 관계도 캔버스는 관계 작성을 시작하는 시험에서만 실제로 그린다(나머지는 jsdom에서 그릴 필요가 없어 빈 대역).
const canvas=vi.hoisted(()=>({real:false}))
vi.mock('../../presentation/features/worldstudio/view/CharacterCards',async original=>{
 const actual=await original<typeof import('../../presentation/features/worldstudio/view/CharacterCards')>()
 return {default:(props:ComponentProps<typeof actual.default>)=>canvas.real?<actual.default {...props}/>:null}
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllEnvs();canvas.real=false})
const manageTab=(name:string)=>within(screen.getByRole('navigation',{name:'세계관 메뉴'})).getByRole('button',{name})
function Destination(){const location=useLocation();return <div>도착 {location.pathname} {JSON.stringify(location.state)}</div>}
function Links(){const navigate=useNavigate();return <><Link to="/link" state={{via:'link'}}>링크 이동</Link><button onClick={()=>navigate('/replace',{replace:true,state:{via:'replace'}})}>교체 이동</button><WorldStudioPage/></>}
async function show(entries=['/before','/worldstudio/qa','/after'],edit=true,twoPeople=false){
 const row=newSetting('people');row.item.title='가람';row.item.text='기존 내용'
 const otherPerson=newSetting('people');otherPerson.item.title='나래'
 const world:StudioWorld={id:'qa',name:'검증 세계',description:'설명',version:1,settings:twoPeople?[row,otherPerson]:[row],analysis:null}
 const other={...structuredClone(world),id:'other',name:'다른 세계'}
 createWorld=vi.fn(async(_name:string,_description:string)=>({...structuredClone(world),id:'created',name:'새 세계'}))
 const repository={listStudio:async()=>[world,other],read:async(id:string)=>structuredClone(id==='other'?other:world),create:createWorld,saveStudio:async(next:StudioWorld)=>next,setPublication:vi.fn()}
 useCase=new WorldStudioUseCase(repository)
 // 편집은 설정 편집 화면(주소 ?card=)을 기록을 쌓지 않고 바로 열어 두 번째 기록을 바꾼다: 행을 눌러 새 기록을 쌓으면 뒤로·앞으로 이동의 기록이 달라진다.
 const opened=edit?entries.map(path=>path==='/worldstudio/qa'?`/worldstudio/qa?card=${row.item.id}`:path):entries
 const router=createMemoryRouter([{path:'*',element:<WorldStudioLeaveProvider><Routes><Route path="/worldstudio/:worldId?" element={<Links/>}/><Route path="*" element={<Destination/>}/></Routes></WorldStudioLeaveProvider>}],{initialEntries:opened,initialIndex:1})
 render(<Provider store={createAppStore({role:'user'})}><RouterProvider router={router} useTransitions={false}/></Provider>)
 if(edit)fireEvent.change(await screen.findByRole('textbox',{name:'IDENTITY.md'}),{target:{value:'보존할 편집 내용'}})
 else await screen.findByRole('heading',{name:'검증 세계',level:1})
 return router
}
it.each([['test','/content'],['mockup','/new']])('opens the work creation route in %s mode',async(mode,path)=>{
 vi.stubEnv('MODE',mode)
 // 소설 버튼은 소설 연결 탭의 한 자리다(헤더에는 없다). 데모는 소설 작성하기가 바로 새 소설 폼으로 가고, 실제 모드의 연결되지 않은 세계관은 소설 연결하기 시트의 새 소설 만들기가 작품 만들기로 간다(시트가 읽는 내 소설 목록은 빈 목록으로 답한다).
 vi.spyOn(appContainer.resolve('episodeUseCase'),'list').mockResolvedValue([])
 const router=await show(undefined,false)
 fireEvent.click(within(screen.getByRole('navigation',{name:'세계관 메뉴'})).getByRole('button',{name:'소설 연결'})) // 소설 버튼은 헤더가 아니라 소설 연결 탭에 있다
 if(mode==='mockup')fireEvent.click(screen.getByRole('link',{name:'소설 작성하기'}))
 else{
  fireEvent.click(screen.getByRole('button',{name:'소설 연결하기'}))
  fireEvent.click(within(await screen.findByRole('dialog',{name:'소설 연결하기'})).getByRole('link',{name:'새 소설 만들기'}))
 }
 await waitFor(()=>expect(router.state.location.pathname).toBe(path))
})
it('blocks Link and programmatic replace, preserving input on cancel and state on approval',async()=>{
 await show();const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(screen.getByText('링크 이동'))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'IDENTITY.md'}).value).toBe('보존할 편집 내용')
 confirm.mockReturnValueOnce(true);fireEvent.click(screen.getByText('교체 이동'))
 expect((await screen.findByText(/도착 \/replace/)).textContent).toContain('"via":"replace"')
 expect(confirm).toHaveBeenCalledTimes(2)
})
it.each([-1,1])('blocks history movement %s until approved',async(delta)=>{
 const router=await show(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 await act(async()=>{await router.navigate(delta)})
 await waitFor(()=>expect(confirm).toHaveBeenCalled())
 expect(router.state.location.pathname).toBe('/worldstudio/qa')
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'IDENTITY.md'}).value).toBe('보존할 편집 내용')
 confirm.mockReturnValue(true);await act(async()=>{await router.navigate(delta)})
 await waitFor(()=>expect(router.state.location.pathname).toBe(delta===-1?'/before':'/after'))
})
it('retains beforeunload protection while dirty',async()=>{
 await show();const event=new Event('beforeunload',{cancelable:true})
 window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
})

it('protects navigation through the actual sidebar Go links',async()=>{
 await show();const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(screen.getByRole('button',{name:'설정집'})) // 사이드바는 설정집 화면에 있다(편집 화면은 집필실처럼 자체 상단 바를 쓴다). 관리 모드에는 공용 상단바(Gnb)가 없어 로고·서재 링크가 사이드바에 있다
 fireEvent.click(screen.getByRole('link',{name:'STORYFORK 홈으로'}))
 await waitFor(()=>expect(confirm).toHaveBeenCalledOnce())
 openCard('가람 인물')
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'IDENTITY.md'}).value).toBe('보존할 편집 내용')
})
it('confirms once before opening another world and creation',async()=>{
 // 관리 화면에는 목록·만들기 화면이 없으므로 다른 세계관 열기와 새 세계관 만들기는 주소 이동이고, 저장하지 않은 입력은 이동 가드가 한 번씩 확인한다.
 const router=await show(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 await act(async()=>{await router.navigate('/worldstudio/other')})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 await act(async()=>{await router.navigate('/worldstudio')})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 confirm.mockReturnValue(true);await act(async()=>{await router.navigate('/worldstudio')})
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio'))
 expect(confirm).toHaveBeenCalledTimes(3)
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'세계관 만들기'}).disabled).toBe(false))
 fireEvent.change(screen.getByRole('textbox',{name:'세계관 이름'}),{target:{value:'새 세계'}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio/created'))
 expect(createWorld).toHaveBeenCalledOnce();expect(confirm).toHaveBeenCalledTimes(3) // 이미 버리고 왔으니 만들 때는 다시 묻지 않는다
})
it('does not discard edits when competing navigations are cancelled',async()=>{
 const router=await show(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 await act(async()=>{void router.navigate('/one');void router.navigate('/two')})
 await waitFor(()=>expect(confirm).toHaveBeenCalled())
 expect(router.state.location.pathname).toBe('/worldstudio/qa')
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'IDENTITY.md'}).value).toBe('보존할 편집 내용')
})

it('opens another world with one confirmation after cancelling once',async()=>{
 const router=await show(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 await act(async()=>{await router.navigate('/worldstudio/other')})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 confirm.mockReturnValue(true);await act(async()=>{await router.navigate('/worldstudio/other')})
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio/other'))
 expect(confirm).toHaveBeenCalledTimes(2)
})
it('keeps the typed name on the creation screen if creation fails and retries with it',async()=>{
 // 편집 중인 세계관과 만들기 화면은 더는 한 화면에 없다(만들기는 /worldstudio에만 있다).
 const router=await show(undefined,false)
 await act(async()=>{await router.navigate('/worldstudio')})
 const name=await screen.findByRole<HTMLInputElement>('textbox',{name:'세계관 이름'})
 await waitFor(()=>expect(screen.getByRole<HTMLButtonElement>('button',{name:'세계관 만들기'}).disabled).toBe(false))
 createWorld.mockRejectedValueOnce(new Error('생성 실패'))
 fireEvent.change(name,{target:{value:'새 세계'}});fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 expect((await screen.findByRole('alert')).textContent).toContain('생성 실패')
 expect(name.value).toBe('새 세계')
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio/created'))
 expect(createWorld).toHaveBeenCalledTimes(2)
})


it('protects an unapplied relationship draft without blocking preserved step navigation',async()=>{
 canvas.real=true
 const router=await show(undefined,false,true),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(manageTab('관계도'))
 fireEvent.click(await screen.findByRole('button',{name:'가람 관계 연결'})) // 캔버스에서 두 카드를 이어 관계 작성 시트를 연다
 fireEvent.click(screen.getByRole('button',{name:'나래 상대 선택'}))
 fireEvent.change(await screen.findByRole('textbox',{name:'실제 관계 1'}),{target:{value:'미적용 관계 원문'}})
 await screen.findByText('관계 입력 미적용')
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
 fireEvent.click(manageTab('설정집'));fireEvent.click(manageTab('관계도')) // 탭 이동은 같은 화면이라 미적용 입력을 지키며 이탈 확인을 하지 않는다
 expect(confirm).not.toHaveBeenCalled()
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'실제 관계 1'}).value).toBe('미적용 관계 원문')
 fireEvent.click(screen.getByText('링크 이동'))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 await act(async()=>{await router.navigate('/worldstudio/other')})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 await act(async()=>{await router.navigate('/worldstudio')})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(3));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 expect(createWorld).not.toHaveBeenCalled()
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'실제 관계 1'}).value).toBe('미적용 관계 원문')
})


it.each([false,true])('shows the world library after Gnb navigation (dirty: %s)',async(edit)=>{
 // Gnb 세계관 메뉴는 공개 세계관 둘러보기(/worlds)로 가므로, 내 세계관 목록(/worldstudio)은 주소로 직접 이동해 확인한다.
 const router=await show(undefined,edit),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 if(edit){
  await act(async()=>{await router.navigate('/worldstudio')})
  await waitFor(()=>expect(confirm).toHaveBeenCalledOnce())
  expect(router.state.location.pathname).toBe('/worldstudio/qa')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'IDENTITY.md'}).value).toBe('보존할 편집 내용')
  confirm.mockReturnValue(true)
 }
 await act(async()=>{await router.navigate('/worldstudio')})
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio'))
 expect(await screen.findByRole('heading',{name:'내 세계관',level:2})).toBeTruthy()
 expect(screen.getByRole('button',{name:'세계관 만들기'})).toBeTruthy()
 expect(screen.getByRole('navigation',{name:'내 세계관'}).textContent).toContain('검증 세계')
 expect(confirm).toHaveBeenCalledTimes(edit?2:0)
})
