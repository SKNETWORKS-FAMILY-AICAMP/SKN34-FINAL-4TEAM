// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter,Route,Routes} from 'react-router'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createAppStore} from './app/store'
import {WorldStudioPage} from './presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioUseCase} from './domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from './domain/entities/studioWorld'
import {putRelation} from './domain/entities/studioRelations'
let useCase:WorldStudioUseCase
let world:StudioWorld
let ids:string[]
vi.mock('./presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('./presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>actual.useWorldStudioViewModel(useCase)}
})
vi.mock('./presentation/features/worldstudio/view/CharacterCards',()=>({default:()=>null}))
vi.mock('./presentation/features/worldstudio/view/WorldMapCanvas',()=>({default:()=>null}))
beforeEach(()=>{
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('places')
 a.item.title='가람';b.item.title='나래';c.item.title='항구';ids=[a.item.id,b.item.id,c.item.id]
 let settings=putRelation([a,b,c],{subjectId:ids[0],targetId:ids[1],predicate:'custom_relation',polarity:'asserted',text:'첫 번째 관계'})
 settings=putRelation(settings,{subjectId:ids[0],targetId:ids[1],predicate:'custom_relation',polarity:'asserted',text:'두 번째 관계'})
 settings=putRelation(settings,{subjectId:ids[1],targetId:ids[2],predicate:'custom_relation',polarity:'asserted',text:'세 번째 관계'})
 world={id:'qa-selection',name:'선택 검증',description:'',version:1,settings,analysis:null}
 useCase=new WorldStudioUseCase({listStudio:async()=>[world],read:async()=>structuredClone(world),create:async()=>world,saveStudio:async w=>w})
})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
async function show(){
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worldstudio/qa-selection']}><Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage/>}/></Routes></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'선택 검증',level:2})
 fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
}
it.each(['검색','유형'] as const)('%s 필터가 편집 카드를 제외해도 편집본을 보존하고 표시 대상을 맞춘다',async mode=>{
 await show();fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'보존할 내용'}})
 if(mode==='검색')fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'항구'}})
 else fireEvent.change(screen.getByRole('combobox',{name:'설정 유형 필터'}),{target:{value:'location'}})
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'설정 이름'}).value).toBe('항구')
 fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:''}})
 fireEvent.change(screen.getByRole('combobox',{name:'설정 유형 필터'}),{target:{value:'all'}})
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 내용')
})
it('opens the requested relation in its pair and preserves a rejected different pair draft',async()=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 fireEvent.change(screen.getByRole('combobox',{name:'source · 관계 주체'}),{target:{value:ids[0]}})
 fireEvent.change(screen.getByRole('combobox',{name:'target · 관계 대상'}),{target:{value:ids[1]}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'보존할 관계 초안'}})
 fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 const review=screen.getByRole('region',{name:'세계관 검토'}),buttons=within(review).getAllByRole('button',{name:'관계 수정'})
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(buttons[2])
 await waitFor(()=>expect(confirm).toHaveBeenCalledOnce())
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'source · 관계 주체'}).value).toBe(ids[0])
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('보존할 관계 초안')
 fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 confirm.mockReturnValue(true);fireEvent.click(within(screen.getByRole('region',{name:'세계관 검토'})).getAllByRole('button',{name:'관계 수정'})[2])
 await waitFor(()=>expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'source · 관계 주체'}).value).toBe(ids[1]))
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'target · 관계 대상'}).value).toBe(ids[2])
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('세 번째 관계')
})
it('focuses the requested relation among multiple relations for the same pair',async()=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 fireEvent.click(within(screen.getByRole('region',{name:'세계관 검토'})).getAllByRole('button',{name:'관계 수정'})[1])
 await waitFor(()=>expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 2'}).value).toBe('두 번째 관계'))
 expect(document.activeElement).toBe(screen.getByRole('combobox',{name:'실제 관계 2'}))
})

it('shows no unrelated editor when there are no filter results',async()=>{
 await show();fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'찾을 수 없는 설정'}})
 expect(screen.queryByRole('region',{name:'선택한 설정 편집'})).toBeNull()
 expect(screen.getByText('조건에 맞는 설정이 없어요.')).toBeTruthy()
})
