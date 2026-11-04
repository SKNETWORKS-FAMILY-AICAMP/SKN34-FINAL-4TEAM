// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {MemoryRouter,Routes,Route} from 'react-router'
import {WorldRelationshipEditor} from './WorldRelationshipEditor'
import {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import {InMemoryWorldStudioRepository} from '../../../../data/world-studio/InMemoryWorldStudioRepository'
import {putRelation} from '../../../../domain/entities/studioRelations'
import {newSetting} from '../../../../domain/entities/studioWorld'
afterEach(cleanup)
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
