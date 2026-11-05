// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Link,Route,RouterProvider,Routes,createMemoryRouter,useLocation,useNavigate} from 'react-router'
import {Provider} from 'react-redux'
import {createAppStore} from './app/store'
import {WorldStudioPage} from './presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioLeaveProvider} from './presentation/features/worldstudio/viewmodel/WorldStudioLeaveProvider'
import {WorldStudioUseCase} from './domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
let useCase:WorldStudioUseCase
let createWorld=vi.fn(async(_name:string,_description:string):Promise<StudioWorld>=>{throw new Error('test setup')})
vi.mock('./presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('./presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>actual.useWorldStudioViewModel(useCase)}
})
vi.mock('./presentation/features/worldstudio/view/CharacterCards',()=>({default:()=>null}))
vi.mock('./presentation/features/worldstudio/view/WorldMapCanvas',()=>({default:()=>null}))
afterEach(()=>{cleanup();vi.restoreAllMocks()})
function Destination(){const location=useLocation();return <div>도착 {location.pathname} {JSON.stringify(location.state)}</div>}
function Links(){const navigate=useNavigate();return <><Link to="/link" state={{via:'link'}}>링크 이동</Link><button onClick={()=>navigate('/replace',{replace:true,state:{via:'replace'}})}>교체 이동</button><WorldStudioPage/></>}
async function show(entries=['/before','/worldstudio/qa','/after'],edit=true,twoPeople=false){
 const row=newSetting('people');row.item.title='가람';row.item.text='기존 내용'
 const otherPerson=newSetting('people');otherPerson.item.title='나래'
 const world:StudioWorld={id:'qa',name:'검증 세계',description:'설명',version:1,settings:twoPeople?[row,otherPerson]:[row],analysis:null}
 const other={...structuredClone(world),id:'other',name:'다른 세계'}
 createWorld=vi.fn(async(_name:string,_description:string)=>({...structuredClone(world),id:'created',name:'새 세계'}))
 const repository={listStudio:async()=>[world,other],read:async(id:string)=>structuredClone(id==='other'?other:world),create:createWorld,saveStudio:async(next:StudioWorld)=>next}
 useCase=new WorldStudioUseCase(repository)
 const router=createMemoryRouter([{path:'*',element:<WorldStudioLeaveProvider><Routes><Route path="/worldstudio/:worldId" element={<Links/>}/><Route path="*" element={<Destination/>}/></Routes></WorldStudioLeaveProvider>}],{initialEntries:entries,initialIndex:1})
 render(<Provider store={createAppStore({role:'user'})}><RouterProvider router={router} useTransitions={false}/></Provider>)
 await screen.findByRole('heading',{name:'검증 세계',level:2})
 if(edit){fireEvent.click(screen.getByRole('button',{name:'설정 카드'}));fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'보존할 편집 내용'}})}
 return router
}
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
 fireEvent.click(screen.getAllByRole('button',{name:/내 서재/})[0])
 await waitFor(()=>expect(confirm).toHaveBeenCalledOnce())
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
})
it('confirms once before opening another world and creation',async()=>{
 const router=await show(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(screen.getByRole('button',{name:'내 세계관'}))
 fireEvent.click(screen.getByRole('button',{name:/다른 세계/}))
 expect(confirm).toHaveBeenCalledTimes(1);expect(router.state.location.pathname).toBe('/worldstudio/qa')
 fireEvent.change(screen.getByRole('textbox',{name:'세계관 이름'}),{target:{value:'새 세계'}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2));expect(createWorld).not.toHaveBeenCalled()
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio/created'))
 expect(createWorld).toHaveBeenCalledOnce();expect(confirm).toHaveBeenCalledTimes(3)
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
 fireEvent.click(screen.getByRole('button',{name:'내 세계관'}))
 fireEvent.click(screen.getByRole('button',{name:/다른 세계/}))
 expect(router.state.location.pathname).toBe('/worldstudio/qa')
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:/다른 세계/}))
 await waitFor(()=>expect(router.state.location.pathname).toBe('/worldstudio/other'))
 expect(confirm).toHaveBeenCalledTimes(2)
})
it('keeps the existing edit if creation fails and still blocks later navigation',async()=>{
 await show();const confirm=vi.spyOn(window,'confirm').mockReturnValue(true)
 createWorld.mockRejectedValueOnce(new Error('생성 실패'))
 fireEvent.click(screen.getByRole('button',{name:'내 세계관'}))
 fireEvent.change(screen.getByRole('textbox',{name:'세계관 이름'}),{target:{value:'새 세계'}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 expect((await screen.findByRole('alert')).textContent).toContain('생성 실패')
 fireEvent.click(screen.getByRole('button',{name:'이어서 작성'}))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
 confirm.mockReturnValue(false);fireEvent.click(screen.getByText('링크 이동'))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 편집 내용')
})


it('protects an unapplied pair draft on navigation while allowing tabs that preserve it',async()=>{
 const router=await show(undefined,false,true),confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 const source=screen.getByRole<HTMLSelectElement>('combobox',{name:'source · 관계 주체'}),target=screen.getByRole<HTMLSelectElement>('combobox',{name:'target · 관계 대상'})
 fireEvent.change(source,{target:{value:within(source).getByRole<HTMLOptionElement>('option',{name:'가람'}).value}})
 fireEvent.change(target,{target:{value:within(target).getByRole<HTMLOptionElement>('option',{name:'나래'}).value}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'미적용 관계 원문'}})
 await screen.findByText('관계 입력 미적용')
 const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
 fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 expect(confirm).not.toHaveBeenCalled()
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('미적용 관계 원문')
 fireEvent.click(screen.getByText('링크 이동'))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(1))
 expect(router.state.location.pathname).toBe('/worldstudio/qa')
 fireEvent.click(screen.getByRole('button',{name:'내 세계관'}))
 fireEvent.click(screen.getByRole('button',{name:/다른 세계/}))
 expect(confirm).toHaveBeenCalledTimes(2)
 fireEvent.change(screen.getByRole('textbox',{name:'세계관 이름'}),{target:{value:'새 세계'}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 만들기'}))
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(3))
 expect(createWorld).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'이어서 작성'}))
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('미적용 관계 원문')
})
