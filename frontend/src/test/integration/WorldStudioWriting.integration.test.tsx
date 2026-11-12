// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {Provider} from 'react-redux'
import {MemoryRouter,Routes,Route} from 'react-router'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createAppStore} from '../../app/store'
import {WorldStudioPage} from '../../presentation/features/worldstudio/view/WorldStudioPage'
import {WorldStudioUseCase} from '../../domain/usecases/WorldStudioUseCase'
import {newSetting,type StudioWorld} from '../../domain/entities/studioWorld'
import {putRelation} from '../../domain/entities/studioRelations'
import type {WorldStudioRepository} from '../../domain/repositories/WorldStudioRepository'
let useCase:WorldStudioUseCase
let world:StudioWorld
let repository:WorldStudioRepository
vi.mock('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel',async original=>{
 const actual=await original<typeof import('../../presentation/features/worldstudio/viewmodel/useWorldStudioViewModel')>()
 return {useWorldStudioViewModel:()=>actual.useWorldStudioViewModel(useCase)}
})
vi.mock('../../presentation/features/worldstudio/view/CharacterCards',()=>({default:()=> <div>인물 카드 대역</div>}))
vi.mock('../../presentation/features/worldstudio/view/WorldMapCanvas',()=>({default:()=> <div>세계관 지도 대역</div>}))
vi.mock('../../presentation/features/worldstudio/view/PresentationWorldMapCanvas',()=>({default:()=> <div>전체 지도 대역</div>}))
beforeEach(()=>{
 const a=newSetting('people');a.item.title='가람';a.item.text='기존 원문';a.tags=['주인공']
 world={id:'qa-writing',name:'작성 검증',description:'세계의 배경',version:1,settings:[a],analysis:null}
 repository={listStudio:async()=>[world],read:async()=>structuredClone(world),create:async()=>world,saveStudio:vi.fn(async next=>{world={...next,version:next.version+1};return structuredClone(world)}),setPublication:vi.fn()}
 useCase=new WorldStudioUseCase(repository)
})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const manageTab=(name:string)=>within(screen.getByRole('navigation',{name:'세계관 메뉴'})).getByRole('button',{name})
const exploreView=(name:string)=>within(screen.getByRole('navigation',{name:'세계관 탐색 보기'})).getByRole('button',{name})
const WIZARD='/worldstudio/qa-writing?new=1'
/** 기본은 탭이 있는 관리 화면이고, 마법사(작성 모드)는 새로 만든 직후의 주소(?new=1)로 연다. */
async function show(path='/worldstudio/qa-writing'){
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={[path]}><Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage/>}/></Routes></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'작성 검증',level:1})
}
it('uses one step navigation, preserves typed input, and returns from review to the selected card',async()=>{
 await show(WIZARD)
 expect(screen.getByRole('navigation',{name:'세계관 작성 단계'})).toBeTruthy()
 expect(screen.queryByRole('navigation',{name:'세계관 도구'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'설정 카드'}));fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
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
 await show()
 expect(screen.getByRole('button',{name:'새 설정'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'인물 0개'})).toBeNull()
 const menu=within(screen.getByRole('navigation',{name:'설정 분류'}))
 expect(menu.getAllByRole('button').map(button=>button.textContent)).toEqual(['전체 1','인물 1'])
 expect(screen.queryByText('상세 설정 · 선택')).toBeNull() // 행을 고르기 전에는 편집 패널이 없다
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByText('상세 설정 · 선택').closest('details')?.open).toBe(false)
 fireEvent.click(menu.getByRole('button',{name:'인물 1'}))
 expect(menu.getByRole('button',{name:'인물 1'}).getAttribute('aria-current')).toBe('true')
 fireEvent.click(screen.getByRole('button',{name:'새 설정'}))
 expect(menu.getByRole('button',{name:/^전체/}).getAttribute('aria-current')).toBe('true')
 fireEvent.change(screen.getByRole('textbox',{name:'설정 이름'}),{target:{value:'나래'}})
 fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 expect(screen.getByRole<HTMLInputElement>('textbox',{name:'설정 이름'}).value).toBe('가람')
})
it('keeps failed edits and AI candidates out of the saved confirmed view',async()=>{
 const candidate=newSetting('people').item;candidate.title='미확정 AI 후보';candidate.text='AI 후보 내용'
 world.analysis={id:'candidate-batch',status:'completed',candidates:[candidate],issues:[]}
 await show();fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'실패해도 남길 내용'}})
 vi.mocked(repository.saveStudio).mockRejectedValueOnce(new Error('저장 충돌'))
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 expect((await screen.findByRole('alert')).textContent).toContain('저장 충돌')
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('실패해도 남길 내용')
 expect(manageTab('세계관 탐색')).toBeTruthy()
 expect(manageTab('AI 후보 검토')).toBeTruthy()
 expect(screen.getByRole('button',{name:'집필 메모 추가'})).toBeTruthy()
 fireEvent.click(manageTab('세계관 탐색'))
 fireEvent.click(exploreView('설정집'))
 const confirmed=screen.getByRole('region',{name:'설정집 WIKI'})
 expect(confirmed.textContent).toContain('기존 원문')
 expect(confirmed.textContent).not.toContain('실패해도 남길 내용')
 expect(confirmed.textContent).not.toContain('미확정 AI 후보')
 expect(confirmed.textContent).not.toContain('AI 후보 내용')
 expect(world.settings[0].item.text).toBe('기존 원문')
})

it('keeps the saved graph and invalid relationship draft until a valid target is saved',async()=>{
 const b=newSetting('people'),c=newSetting('people');b.item.title='나래';c.item.title='다온'
 world.settings=putRelation([...world.settings,b,c],{subjectId:world.settings[0].item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 const before=structuredClone(world),relation=world.settings[3].item
 await show()
 fireEvent.click(screen.getByText('기존 설정·관계 1개'))
 fireEvent.click(within(screen.getByRole('navigation',{name:'기존 설정과 관계'})).getByRole('button',{name:/가람 · 친구 · 나래/}))
 fireEvent.click(screen.getByText('상세 설정 · 선택'))
 fireEvent.change(screen.getByRole('combobox',{name:'관계 대상'}),{target:{value:''}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 expect((await screen.findByRole('alert')).textContent).toContain('관계 주체와 대상을 선택해 주세요.')
 expect(screen.getByText('저장 실패 · 입력은 유지됩니다')).toBeTruthy()
 expect(repository.saveStudio).not.toHaveBeenCalled()
 expect(world).toEqual(before)
 fireEvent.click(manageTab('세계관 탐색'))
 fireEvent.click(exploreView('인물 관계도'))
 expect(await screen.findByText('3개 설정 · 1개 연결')).toBeTruthy()
 fireEvent.click(manageTab('설정집'))
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'관계 대상'}).value).toBe('')
 fireEvent.change(screen.getByRole('combobox',{name:'관계 대상'}),{target:{value:c.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 await screen.findByText('서버에 현재 세계관을 저장했어요. 관계는 현재 상태만 보관하며 과거 관계 복원은 지원하지 않습니다.')
 expect(repository.saveStudio).toHaveBeenCalledTimes(1)
 expect(world.settings[3].item).toMatchObject({id:relation.id,subjectId:relation.subjectId,targetId:c.item.id})
 expect(world.version).toBe(before.version+1)
})

it('exposes exploration shortcuts and switches from character cards to the existing 2D graph',async()=>{
 await show()
 fireEvent.click(manageTab('세계관 탐색'))
 fireEvent.click(exploreView('인물 관계도'))
 expect(screen.getByRole('heading',{name:'인물 관계도 · 2D'})).toBeTruthy()
 expect(await screen.findByText('인물 카드 대역')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'그래프형'}))
 expect(await screen.findByText('세계관 지도 대역')).toBeTruthy()
 expect(screen.queryByRole('heading',{name:'저장된 현재 관계도'})).toBeNull()
 fireEvent.click(exploreView('설정집'))
 expect(screen.getByRole('region',{name:'설정집 WIKI'})).toBeTruthy()
 fireEvent.click(exploreView('전체 세계관 지도'))
 expect(screen.getByRole('region',{name:'전체 세계관 지도'})).toBeTruthy()
 fireEvent.click(exploreView('초기 역사 시간선'))
 expect(screen.getByRole('heading',{name:'저장된 시간선'})).toBeTruthy()
 fireEvent.click(manageTab('설정집'))
 expect(screen.getByRole('table',{name:'설정 카드 목록'})).toBeTruthy()
 expect(screen.queryByRole('navigation',{name:'세계관 작성 단계'})).toBeNull() // 관리 모드에는 단계가 없다
})


it('marks exactly one writing step active when switching between cards and relationships',async()=>{
 await show(WIZARD)
 const nav=screen.getByRole('navigation',{name:'세계관 작성 단계'})
 for(const label of ['설정 카드','관계 연결 (선택)','설정 카드']){
  fireEvent.click(within(nav).getByRole('button',{name:label}))
  expect(within(nav).getAllByRole('button').filter(button=>button.getAttribute('aria-current')==='step')).toEqual([within(nav).getByRole('button',{name:label})])
 }
})

it('rejects a duplicate relationship edited in the general form without losing its id and draft',async()=>{
 const b=newSetting('people');b.item.title='나래'
 world.settings=putRelation([...world.settings,b],{subjectId:world.settings[0].item.id,targetId:b.item.id,predicate:'custom_relation',title:'동료 관계',text:'동료',polarity:'asserted'})
 world.settings=putRelation(world.settings,{subjectId:world.settings[0].item.id,targetId:b.item.id,predicate:'custom_relation',title:'경쟁자 관계',text:'경쟁자',polarity:'asserted'})
 const ids=world.settings.map(s=>s.item.id)
 await show()
 fireEvent.click(screen.getByText('기존 설정·관계 2개'))
 fireEvent.click(within(screen.getByRole('navigation',{name:'기존 설정과 관계'})).getByRole('button',{name:/경쟁자/}))
 fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'동료'}})
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 expect((await screen.findByRole('alert')).textContent).toContain('이미')
 expect(repository.saveStudio).not.toHaveBeenCalled()
 expect(world.settings.map(s=>s.item.id)).toEqual(ids)
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:'설명'}).value).toBe('동료')
})
