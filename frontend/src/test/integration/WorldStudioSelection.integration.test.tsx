// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter,Route,Routes} from 'react-router'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createAppStore} from '../../app/store'
import {WorldStudioPage} from '../../presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioUseCase} from '../../domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from '../../domain/entities/studioWorld'
import {putRelation} from '../../domain/entities/studioRelations'
let useCase:WorldStudioUseCase
let world:StudioWorld
let ids:string[]
let saveStudio=vi.fn(async(value:StudioWorld)=>value)
vi.mock('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>actual.useWorldStudioViewModel(useCase)}
})
beforeEach(()=>{
 const a=newSetting('people'),b=newSetting('people'),c=newSetting('places')
 a.item.title='가람';b.item.title='나래';c.item.title='항구';ids=[a.item.id,b.item.id,c.item.id]
 let settings=putRelation([a,b,c],{subjectId:ids[0],targetId:ids[1],predicate:'custom_relation',polarity:'asserted',text:'첫 번째 관계'})
 settings=putRelation(settings,{subjectId:ids[0],targetId:ids[1],predicate:'custom_relation',polarity:'asserted',text:'두 번째 관계'})
 settings=putRelation(settings,{subjectId:ids[1],targetId:ids[2],predicate:'custom_relation',polarity:'asserted',text:'세 번째 관계'})
 world={id:'qa-selection',name:'선택 검증',description:'',version:1,settings,analysis:null}
 saveStudio=vi.fn(async(value:StudioWorld)=>value)
 useCase=new WorldStudioUseCase({listStudio:async()=>[world],read:async()=>structuredClone(world),create:async()=>world,saveStudio,setPublication:vi.fn()})
})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
/** 기본은 탭이 있는 관리 화면(설정집이 먼저 열린다)이고, `wizard`는 새로 만든 직후의 주소(?new=1)로 여는 4단계 마법사(검토 단계가 있다)다. */
async function show(wizard=false){
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={[wizard?'/worldstudio/qa-selection?new=1':'/worldstudio/qa-selection']}><Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage/>}/></Routes></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'선택 검증',level:1})
 if(wizard)fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
}
it.each(['검색','유형'] as const)('%s 필터가 카드를 제외해도 편집본을 보존한다',async mode=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'보존할 내용'}})
 const rail=()=>within(screen.getByRole('navigation',{name:'설정 카드 목록'}))
 // 편집 화면의 레일 필터가 편집 중인 카드를 목록에서 빼도 편집 화면과 편집본은 그대로다
 if(mode==='검색')fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'항구'}})
 else fireEvent.click(within(screen.getByRole('group',{name:'설정 분류'})).getByRole('button',{name:/^장소/}))
 expect(rail().queryByRole('button',{name:'가람 인물'})).toBeNull()
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 내용')
 fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:''}})
 fireEvent.click(within(screen.getByRole('group',{name:'설정 분류'})).getByRole('button',{name:'전체'}))
 fireEvent.click(rail().getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('보존할 내용')
})
it('shows an empty result without an unrelated editor',async()=>{
 await show();fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'없는 설정'}})
 expect(screen.queryByRole('region',{name:'선택한 설정 편집'})).toBeNull()
 expect(screen.getByText('조건에 맞는 설정이 없어요.')).toBeTruthy()
})
it('keeps focus and identifies an edited card that no longer matches the filter',async()=>{
 await show();fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'가람'}})
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 const name=screen.getByRole<HTMLInputElement>('textbox',{name:'설정 이름'})
 name.focus();fireEvent.change(name,{target:{value:'바뀐 이름'}})
 expect(name.value).toBe('바뀐 이름');expect(document.activeElement).toBe(name)
 // 검색어에 더는 맞지 않아 레일 목록에서는 빠지지만 편집 화면은 그 카드를 그대로 열어 둔다(게시판은 설정집으로 돌아가면 빈 결과로 알린다)
 expect(within(screen.getByRole('navigation',{name:'설정 카드 목록'})).queryByRole('button',{name:'바뀐 이름 인물'})).toBeNull()
 expect(screen.getByRole('region',{name:'선택한 설정 편집'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'설정집'}))
 expect(screen.getByText('조건에 맞는 설정이 없어요.')).toBeTruthy()
})
it('opens a requested pair only after preserving or discarding the current draft',async()=>{
 await show(true);fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 fireEvent.change(screen.getByRole('combobox',{name:'관계 주체'}),{target:{value:ids[0]}})
 fireEvent.change(screen.getByRole('combobox',{name:'관계 대상'}),{target:{value:ids[1]}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'보존할 관계 초안'}})
 fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fireEvent.click(within(screen.getByRole('region',{name:'세계관 검토'})).getAllByRole('button',{name:'관계 수정'})[2])
 await waitFor(()=>expect(confirm).toHaveBeenCalledOnce())
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'관계 주체'}).value).toBe(ids[0])
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('보존할 관계 초안')
 fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 confirm.mockReturnValue(true)
 fireEvent.click(within(screen.getByRole('region',{name:'세계관 검토'})).getAllByRole('button',{name:'관계 수정'})[2])
 await waitFor(()=>expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'관계 주체'}).value).toBe(ids[1]))
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'관계 대상'}).value).toBe(ids[2])
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('세 번째 관계')
})
it('focuses the requested relationship ID among several for the same pair',async()=>{
 await show(true);fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 fireEvent.click(within(screen.getByRole('region',{name:'세계관 검토'})).getAllByRole('button',{name:'관계 수정'})[1])
 await waitFor(()=>expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 2'}).value).toBe('두 번째 관계'))
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('combobox',{name:'실제 관계 2'})))
})

it('opens another relationship in the same pair without discarding an unapplied draft',async()=>{
 await show(true);fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 fireEvent.change(screen.getByRole('combobox',{name:'관계 주체'}),{target:{value:ids[0]}})
 fireEvent.change(screen.getByRole('combobox',{name:'관계 대상'}),{target:{value:ids[1]}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'유지할 첫 관계'}})
 fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 const confirm=vi.spyOn(window,'confirm')
 fireEvent.click(within(screen.getByRole('region',{name:'세계관 검토'})).getAllByRole('button',{name:'관계 수정'})[1])
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('combobox',{name:'실제 관계 2'})))
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('유지할 첫 관계')
 expect(confirm).not.toHaveBeenCalled()
})

it('preserves the original filtered-out edit after a server save failure',async()=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'저장 실패 후 남길 내용'}})
 fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:'항구'}})
 saveStudio.mockRejectedValueOnce(new Error('저장 실패'))
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 expect((await screen.findByRole('alert')).textContent).toContain('저장 실패')
 fireEvent.change(screen.getByRole('searchbox',{name:'설정 검색'}),{target:{value:''}})
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('저장 실패 후 남길 내용')
 fireEvent.click(screen.getByRole('button',{name:'설정집'}))
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('저장 실패 후 남길 내용')
 expect(world.settings[0].item.text).toBe('')
})
