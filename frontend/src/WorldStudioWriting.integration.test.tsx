// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter,Routes,Route} from 'react-router'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createAppStore} from './app/store'
import {WorldStudioPage} from './presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioUseCase} from './domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
import type {WorldStudioRepository} from './domain/repositories/WorldStudioRepository'
let useCase:WorldStudioUseCase
let world:StudioWorld
let repository:WorldStudioRepository
vi.mock('./presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('./presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>actual.useWorldStudioViewModel(useCase)}
})
vi.mock('./presentation/features/worldstudio/view/CharacterCards',()=>({default:()=> <div>인물 그래프 대역</div>}))
vi.mock('./presentation/features/worldstudio/view/WorldMapCanvas',()=>({default:()=> <div>세계관 지도 대역</div>}))
beforeEach(()=>{
 const a=newSetting('people');a.item.title='가람';a.item.text='기존 원문';a.tags=['주인공']
 world={id:'qa-writing',name:'작성 검증',description:'세계의 배경',version:1,settings:[a],analysis:null}
 repository={listStudio:async()=>[world],read:async()=>structuredClone(world),create:async()=>world,saveStudio:vi.fn(async next=>{world={...next,version:next.version+1};return structuredClone(world)})}
 useCase=new WorldStudioUseCase(repository)
})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
async function show(){
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worldstudio/qa-writing']}><Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage/>}/></Routes></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'작성 검증',level:2})
}
it('uses one step navigation, preserves typed input, and returns from review to the selected card',async()=>{
 await show()
 expect(screen.getByRole('navigation',{name:'세계관 작성 단계'})).toBeTruthy()
 expect(screen.queryByRole('navigation',{name:'세계관 도구'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
 fireEvent.change(screen.getByRole('textbox',{name:'설정 이름'}),{target:{value:'가람 수정'}})
 fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'보존할 미저장 원문'}})
 fireEvent.click(screen.getByRole('button',{name:'관계 없이 검토·저장'}))
 const review=screen.getByRole('region',{name:'세계관 검토'})
 expect(review.textContent).toContain('보존할 미저장 원문')
 fireEvent.click(within(review).getByRole('button',{name:'가람 수정 수정'}))
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'설정 이름'}).value).toBe('가람 수정')
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 미저장 원문')
 expect(world.settings[0].item.text).toBe('기존 원문')
})
it('makes add visible and keeps management entries out of the compact type filter',async()=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
 expect(screen.getByRole('button',{name:'설정 추가'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'인물 0개'})).toBeNull()
 const filter=screen.getByRole('combobox',{name:'설정 유형 필터'})
 expect(within(filter).queryByRole('option',{name:'기존 관계'})).toBeNull()
 expect(within(filter).queryByRole('option',{name:'분류 확인'})).toBeNull()
 expect(screen.getByText('상세 설정 · 선택').closest('details')?.open).toBe(false)
 fireEvent.change(filter,{target:{value:'location'}})
 fireEvent.click(screen.getByRole('button',{name:'설정 추가'}))
 expect((filter as HTMLSelectElement).value).toBe('all')
 fireEvent.change(screen.getByRole('textbox',{name:'설정 이름'}),{target:{value:'나래'}})
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'설정 이름'}).value).toBe('가람')
})
it('keeps the edit when save fails and keeps exploration and AI available as auxiliary tools',async()=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
 fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'실패해도 남길 내용'}})
 vi.mocked(repository.saveStudio).mockRejectedValueOnce(new Error('저장 충돌'))
 fireEvent.click(screen.getByRole('button',{name:'관계 없이 검토·저장'}))
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 expect((await screen.findByRole('alert')).textContent).toContain('저장 충돌')
 fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('실패해도 남길 내용')
 fireEvent.click(screen.getByText('도구'))
 expect(screen.getByRole('button',{name:'세계관 탐색'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'AI 후보 검토'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'집필 메모 추가'})).toBeTruthy()
 expect(world.settings[0].item.text).toBe('기존 원문')
})

it('exposes exploration shortcuts and renders the character view through the 2D map component',async()=>{
 await show()
 fireEvent.click(screen.getByText('도구'))
 fireEvent.click(screen.getByRole('button',{name:'세계관 탐색'}))
 fireEvent.click(screen.getByRole('button',{name:'인물 관계도'}))
 expect(screen.getByRole('heading',{name:'인물 관계도 · 2D'})).toBeTruthy()
 expect(await screen.findByText('세계관 지도 대역')).toBeTruthy()
 expect(screen.queryByRole('heading',{name:'확정 관계도'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'설정집'}))
 expect(screen.getByRole('heading',{name:'확정 Wiki'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'전체 세계관 지도'}))
 expect(screen.getByRole('region',{name:'전체 세계관 지도'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'초기 역사 시간선'}))
 expect(screen.getByRole('heading',{name:'확정 시간선'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'작성으로 돌아가기'}))
 expect(screen.getByRole('navigation',{name:'세계관 작성 단계'})).toBeTruthy()
})
