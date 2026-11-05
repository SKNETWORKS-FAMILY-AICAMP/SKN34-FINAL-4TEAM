// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {MemoryRouter,Routes,Route} from 'react-router'
import {Provider} from 'react-redux'
import {createAppStore} from '../../../../app/store'
import {WorldRelationshipEditor} from './WorldRelationshipEditor'
import {WorldStudioPage} from './WorldStudioPage'
import * as studioViewModel from '../viewmodel/useWorldStudioViewModel'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import {InMemoryWorldStudioRepository} from '../../../../data/world-studio/InMemoryWorldStudioRepository'
import {putRelation} from '../../../../domain/entities/studioRelations'
import {newSetting} from '../../../../domain/entities/studioWorld'
const {useWorldStudioViewModel}=studioViewModel
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('selects source and target, applies free prose and preserves the relation ID on edit',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('places')
 a.item.title='가람';b.item.title='항구';world.settings=[a,b];await useCase.save(world)
 function Harness(){const vm=useWorldStudioViewModel(useCase);return vm.editing?<><WorldRelationshipEditor studio={vm}/><button onClick={vm.save}>메모리에 저장</button></>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.change(await screen.findByRole('combobox',{name:'source · 관계 주체'}),{target:{value:a.item.id}})
 fireEvent.change(screen.getByRole('combobox',{name:'target · 관계 대상'}),{target:{value:b.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'지키는 장소'}})
 fireEvent.click(screen.getByRole('button',{name:'편집본에 적용'}))
 fireEvent.click(screen.getByRole('button',{name:'메모리에 저장'}))
 await waitFor(async()=>expect((await useCase.read(world.id)).settings).toHaveLength(3))
 const relation=(await useCase.read(world.id)).settings[2].item
 fireEvent.click(screen.getByRole('button',{name:'가람 · 지키는 장소 · 항구'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'돌아갈 장소'}})
 fireEvent.click(screen.getByRole('button',{name:'편집본에 적용'}))
 fireEvent.click(screen.getByRole('button',{name:'메모리에 저장'}))
 await waitFor(async()=>expect((await useCase.read(world.id)).settings[2].item).toMatchObject({id:relation.id,text:'돌아갈 장소'}))
})

it('removes an incident relation with its person and restores both original IDs on undo',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 world.settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',text:'친구',polarity:'asserted'})
 await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.change(await screen.findByRole('combobox',{name:'source · 관계 주체'}),{target:{value:a.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'선택한 인물 삭제'}))
 expect(screen.getByRole('region',{name:'인물 삭제 확인'}).textContent).toContain('관계·감정 1개')
 fireEvent.click(screen.getByRole('button',{name:'인물과 연결 삭제'}))
 expect(current!.editing!.settings.map(s=>s.item.id)).toEqual([b.item.id])
 expect(current!.saved!.settings).toHaveLength(3)
 fireEvent.click(screen.getByRole('button',{name:'인물 삭제 되돌리기'}))
 expect(current!.editing!.settings).toEqual(world.settings)
 expect(current!.dirty).toBe(false)
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'source · 관계 주체'}).value).toBe(a.item.id)
 expect(screen.queryByRole('button',{name:'인물 삭제 되돌리기'})).toBeNull()
})

it.each(['text','title','name'] as const)('preserves the same-mounted pair draft and latest saved settings after an external %s edit',async field=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('탭 충돌 검증',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 world.settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'friend_of',polarity:'asserted'})
 world.settings=putRelation(world.settings,{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',text:'오랜 동료이자 경쟁자'})
 const relation=world.settings[2].item
 await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 vi.spyOn(studioViewModel,'useWorldStudioViewModel').mockImplementation(()=>{current=useWorldStudioViewModel(useCase);return current})
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage/>}/></Routes></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'탭 충돌 검증',level:2})
 fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 fireEvent.click(screen.getByRole('button',{name:'가람 · 친구 · 나래'}))
 const fact=screen.getByRole('combobox',{name:'실제 관계 1'}),draft=screen.getByRole<HTMLTextAreaElement>('textbox',{name:'나래 → 가람 감정 1'})
 const prose='믿고 싶지만 아직은 두렵다.\n패널에 남겨 둘 감정'
 fireEvent.change(draft,{target:{value:prose}})
 fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
 if(field!=='name'){
  fireEvent.click(screen.getByText('기존 설정·관계 2개'))
  fireEvent.click(within(screen.getByRole('navigation',{name:'기존 설정과 관계'})).getByRole('button',{name:/가람 · 친구 · 나래/}))
 }else fireEvent.click(screen.getByRole('button',{name:'가람 인물'}))
 fireEvent.change(screen.getByRole('textbox',{name:field==='text'?'설명':'설정 이름'}),{target:{value:field==='text'?'설정 탭의 최신 설명':field==='title'?'설정 탭의 최신 이름':'가람 수정'}})
 fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 await screen.findByText('이 탭의 메모리에 저장했어요. 새로고침하면 초기화됩니다.')
 const latest=await useCase.read(world.id)
 expect(latest.settings[2].item).toMatchObject({id:relation.id,...(field==='text'?{text:'설정 탭의 최신 설명'}:field==='title'?{title:'설정 탭의 최신 이름'}:{title:'가람 수정 · 친구 · 나래',text:'가람 수정 · 친구 · 나래'})})
 fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 expect(screen.getByRole('combobox',{name:'실제 관계 1'})).toBe(fact)
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:field==='name'?'나래 → 가람 수정 감정 1':'나래 → 가람 감정 1'}).value).toBe(prose)
 fireEvent.click(screen.getByRole('button',{name:'편집본에 적용'}))
 const panel=screen.getByRole('region',{name:'관계 편집'})
 expect(within(panel).getByRole('alert').textContent).toContain('다른 곳에서 관계가 변경')
 expect(within(panel).getByRole('alert').textContent).toContain('입력은 유지')
 expect(screen.getByRole<HTMLTextAreaElement>('textbox',{name:field==='name'?'나래 → 가람 수정 감정 1':'나래 → 가람 감정 1'}).value).toBe(prose)
 expect(current!.editing!.settings).toEqual(latest.settings)
 expect(current!.editing!.settings[3].item.text).toBe('오랜 동료이자 경쟁자')
 expect(current!.dirty).toBe(false)
 expect((await useCase.read(world.id)).settings).toEqual(latest.settings)
})

it('rejects unsaved general-form duplicates at panel apply while preserving draft, latest and saved settings until a valid save',async()=>{
 const repository=new InMemoryWorldStudioRepository(),useCase=new WorldStudioUseCase(repository)
 const world=await useCase.create('중복 기준 검증',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래'
 world.settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',title:'동료 관계',text:'동료'})
 world.settings=putRelation(world.settings,{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',polarity:'asserted',title:'경쟁자 관계',text:'경쟁자'})
 const saved=await useCase.save(world),save=vi.spyOn(repository,'saveStudio')
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 vi.spyOn(studioViewModel,'useWorldStudioViewModel').mockImplementation(()=>{current=useWorldStudioViewModel(useCase);return current})
 render(<Provider store={createAppStore({role:'user'})}><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage/>}/></Routes></MemoryRouter></Provider>)
 await screen.findByRole('heading',{name:'중복 기준 검증',level:2})
 fireEvent.click(screen.getByRole('button',{name:'설정 카드'}))
 fireEvent.click(screen.getByText('기존 설정·관계 2개'))
 fireEvent.click(within(screen.getByRole('navigation',{name:'기존 설정과 관계'})).getByRole('button',{name:/경쟁자 관계/}))
 fireEvent.change(screen.getByRole('textbox',{name:'설명'}),{target:{value:'동료'}})
 const latest=current!.editing!,persisted=current!.saved!
 fireEvent.click(screen.getByRole('button',{name:'관계 연결 (선택)'}))
 fireEvent.click(within(screen.getByRole('navigation',{name:'저장할 관계 목록'})).getAllByRole('button',{name:'가람 · 동료 · 나래'})[1])
 const panel=screen.getByRole('region',{name:'관계 편집'})
 fireEvent.click(within(panel).getAllByText('항목 이름 직접 쓰기')[1])
 const title=within(panel).getByRole<HTMLInputElement>('textbox',{name:'실제 관계 2 이름'})
 const emotion=within(panel).getByRole<HTMLTextAreaElement>('textbox',{name:'나래 → 가람 감정 1'})
 const prose='믿고 싶지만 두렵다.\n적용 실패 후에도 남겨 둘 감정'
 fireEvent.change(title,{target:{value:'패널에서 고친 이름'}})
 fireEvent.change(emotion,{target:{value:prose}})
 fireEvent.click(within(panel).getByRole('button',{name:'편집본에 적용'}))
 expect(within(panel).getByRole('alert').textContent).toContain('이미')
 expect(title.value).toBe('패널에서 고친 이름')
 expect(emotion.value).toBe(prose)
 expect(current!.relationDirty).toBe(true)
 expect(current!.dirty).toBe(true)
 expect(current!.editing).toBe(latest)
 expect(current!.editing!.settings[3].item).toMatchObject({id:saved.settings[3].item.id,title:'경쟁자 관계',text:'동료'})
 expect(current!.saved).toBe(persisted)
 expect(current!.saved).toEqual(saved)
 expect(await useCase.read(world.id)).toEqual(saved)
 expect(save).not.toHaveBeenCalled()
 fireEvent.change(within(panel).getByRole('combobox',{name:'실제 관계 2'}),{target:{value:'경쟁자'}})
 fireEvent.click(within(panel).getByRole('button',{name:'편집본에 적용'}))
 expect(screen.queryByRole('button',{name:'편집본에 적용'})).toBeNull()
 expect(current!.saved).toEqual(saved)
 fireEvent.click(screen.getByRole('button',{name:'검토·저장'}))
 fireEvent.click(screen.getByRole('button',{name:'세계관 저장'}))
 await screen.findByText('이 탭의 메모리에 저장했어요. 새로고침하면 초기화됩니다.')
 expect(save).toHaveBeenCalledTimes(1)
 const result=await useCase.read(world.id)
 expect(result.settings.slice(0,4).map(s=>s.item.id)).toEqual(saved.settings.map(s=>s.item.id))
 expect(result.settings[2]).toEqual(saved.settings[2])
 expect(result.settings[3].item).toMatchObject({id:saved.settings[3].item.id,title:'패널에서 고친 이름',text:'경쟁자'})
 expect(result.settings[4].item).toMatchObject({subjectId:b.item.id,targetId:a.item.id,text:prose})
 expect(current!.saved).toEqual(result)
 expect(current!.dirty).toBe(false)
})

it('preserves an unapplied relationship draft when changing targets is cancelled',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people'),c=newSetting('people')
 a.item.title='가람';b.item.title='나래';c.item.title='다온';world.settings=[a,b,c];await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 vi.spyOn(window,'confirm').mockReturnValue(false)
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.change(await screen.findByRole('combobox',{name:'source · 관계 주체'}),{target:{value:a.item.id}})
 fireEvent.change(screen.getByRole('combobox',{name:'target · 관계 대상'}),{target:{value:b.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'관계 작성'}))
 fireEvent.change(screen.getByRole('combobox',{name:'실제 관계 1'}),{target:{value:'작성 중인 관계'}})
 await waitFor(()=>expect(current!.relationDirty).toBe(true))
 fireEvent.change(screen.getByRole('combobox',{name:'target · 관계 대상'}),{target:{value:c.item.id}})
 expect(screen.getByRole<HTMLSelectElement>('combobox',{name:'target · 관계 대상'}).value).toBe(b.item.id)
 expect(screen.getByRole<HTMLInputElement>('combobox',{name:'실제 관계 1'}).value).toBe('작성 중인 관계')
 expect(window.confirm).toHaveBeenCalledOnce()
})

it('keeps the deletion undo and prior edits when saving fails',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),a=newSetting('people'),b=newSetting('people')
 a.item.title='가람';b.item.title='나래';world.settings=putRelation([a,b],{subjectId:a.item.id,targetId:b.item.id,predicate:'custom_relation',text:'친구',polarity:'asserted'});await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={<Harness/>}/></Routes></MemoryRouter>)
 await screen.findByRole('combobox',{name:'source · 관계 주체'})
 act(()=>current!.patch({name:''}))
 await waitFor(()=>expect(current!.editing!.name).toBe(''))
 act(()=>{current!.deletePerson(a.item.id)})
 await waitFor(()=>expect(current!.canUndoPersonDeletion).toBe(true))
 await act(async()=>{await current!.save()})
 await waitFor(()=>expect(current!.saveState).toBe('failed'))
 expect(current!.canUndoPersonDeletion).toBe(true)
 act(()=>{current!.undoPersonDeletion()})
 await waitFor(()=>expect(current!.editing!.settings.map(s=>s.item.id)).toEqual(world.settings.map(s=>s.item.id)))
 expect(current!.editing!.name).toBe('')
 expect(current!.dirty).toBe(true)
})


it('closes a stale person deletion confirmation when the card type changes',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계',''),person=newSetting('people');person.item.title='가람';world.settings=[person];await useCase.save(world)
 let current:ReturnType<typeof useWorldStudioViewModel>|undefined
 function Harness(){const vm=useWorldStudioViewModel(useCase);current=vm;return vm.editing?<WorldRelationshipEditor studio={vm}/>:null}
 render(<MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={<Harness/>}/></Routes></MemoryRouter>)
 fireEvent.change(await screen.findByRole('combobox',{name:'source · 관계 주체'}),{target:{value:person.item.id}})
 fireEvent.click(screen.getByRole('button',{name:'선택한 인물 삭제'}))
 expect(screen.getByRole('region',{name:'인물 삭제 확인'})).toBeTruthy()
 act(()=>current!.changeCardType(person.item.id,'location'))
 expect(screen.queryByRole('region',{name:'인물 삭제 확인'})).toBeNull()
 expect(current!.editing!.settings[0].item.id).toBe(person.item.id)
})
