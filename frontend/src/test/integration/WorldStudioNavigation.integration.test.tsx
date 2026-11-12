// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Link,Route,RouterProvider,Routes,createMemoryRouter,useLocation,useNavigate} from 'react-router'
import {Provider} from 'react-redux'
import {createAppStore} from '../../app/store'
import {WorldStudioPage} from '../../presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioLeaveProvider} from '../../presentation/features/worldstudio/viewmodel/WorldStudioLeaveProvider'
import {WorldStudioUseCase} from '../../domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from '../../domain/entities/studioWorld'
let useCase:WorldStudioUseCase
let createWorld=vi.fn(async(_name:string,_description:string):Promise<StudioWorld>=>{throw new Error('test setup')})
vi.mock('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>actual.useWorldStudioViewModel(useCase)}
})
vi.mock('../../presentation/features/worldstudio/view/CharacterCards',()=>({default:()=>null}))
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllEnvs()})
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
 if(edit)fireEvent.change(await screen.findByRole('textbox',{name:'설명'}),{target:{value:'보존할 편집 내용'}})
 else await screen.findByRole('heading',{name:'검증 세계',level:1})
 return router
}
it.each([['test','/content'],['mockup','/new']])('opens the work creation route in %s mode',async(mode,path)=>{
 vi.stubEnv('MODE',mode)
 const router=await show(undefined,false)
 fireEvent.click(screen.getByRole('link',{name:'소설 작성하기'}))
 await waitFor(()=>expect(router.state.location.pathname).toBe(path))
})
it('blocks Link and programmatic replace, preserving input on cancel and state on approval',async()=>{
 await show();const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(screen.getByText('링크 이동'))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
 confirm.mockReturnValueOnce(true);fireEvent.click(screen.getByText('교체 이동'))
 expect((await screen.findByText(/도착 \/replace/)).textContent).toContain('"via":"replace"')
 expect(confirm).toHaveBeenCalledTimes(2)
})
it.each([-1,1])('blocks history movement %s until approved',async(delta)=>{
 const router=await show(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 await act(async()=>{await router.navigate(delta)})
 await waitFor(()=>expect(confirm).toHaveBeenCalled())
 expect(router.state.location.pathname).toBe('/worldstudio/qa')
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
 confirm.mockReturnValue(true);await act(async()=>{await router.navigate(delta)})
 await waitFor(()=>expect(router.state.location.pathname).toBe(delta===-1?'/before':'/after'))
})
it('retains beforeunload protection while dirty',async()=>{
 await show();const event=new Event('beforeunload',{cancelable:true})
 window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
})

it('protects navigation through the actual Gnb Go button',async()=>{
 await show();const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(screen.getByRole('button',{name:'설정집'})) // Gnb는 설정집 화면에 있다(편집 화면은 집필실처럼 자체 상단 바를 쓴다)
 fireEvent.click(screen.getAllByRole('link',{name:/내 서재/})[0])
 await waitFor(()=>expect(confirm).toHaveBeenCalledOnce())
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
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
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
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
 const router=await show(undefined,false,true),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(manageTab('인물 관계도'))
 const source=screen.getByRole<HTMLSelectElement>('combobox',{name:'관계 주체'}),target=screen.getByRole<HTMLSelectElement>('combobox',{name:'관계 대상'})
 fireEvent.change(source,{target:{value:within(source).getByRole<HTMLOptionElement>('option',{name:'가람'}).value}})
 fireEvent.change(target,{target:{value:within(target).getByRole<HTMLOptionElement>('option',{name:'나래'}).value}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'미적용 관계 원문'}})
 await screen.findByText('관계 입력 미적용')
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
 fireEvent.click(manageTab('설정집'));fireEvent.click(manageTab('인물 관계도')) // 탭 이동은 같은 화면이라 미적용 입력을 지키며 이탈 확인을 하지 않는다
 expect(confirm).not.toHaveBeenCalled()
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('미적용 관계 원문')
 fireEvent.click(screen.getByText('링크 이동'))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 await act(async()=>{await router.navigate('/worldstudio/other')})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 await act(async()=>{await router.navigate('/worldstudio')})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(3));expect(router.state.location.pathname).toBe('/worldstudio/qa')
 expect(createWorld).not.toHaveBeenCalled()
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('미적용 관계 원문')
})


it.each([false,true])('shows the world library after Gnb navigation (dirty: %s)',async(edit)=>{
 // Gnb 세계관 메뉴는 공개 세계관 둘러보기(/worlds)로 가므로, 내 세계관 목록(/worldstudio)은 주소로 직접 이동해 확인한다.
 const router=await show(undefined,edit),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 if(edit){
  await act(async()=>{await router.navigate('/worldstudio')})
  await waitFor(()=>expect(confirm).toHaveBeenCalledOnce())
  expect(router.state.location.pathname).toBe('/worldstudio/qa')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
  confirm.mockReturnValue(true)
 }
 await act(async()=>{await router.navigate('/worldstudio')})
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio'))
 expect(await screen.findByRole('heading',{name:'내 세계관',level:2})).toBeTruthy()
 expect(screen.getByRole('button',{name:'세계관 만들기'})).toBeTruthy()
 expect(screen.getByRole('navigation',{name:'내 세계관'}).textContent).toContain('검증 세계')
 expect(confirm).toHaveBeenCalledTimes(edit?2:0)
})
