// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {MemoryRouter,Routes,Route} from 'react-router'
import {WorldRelationshipEditor} from './WorldRelationshipEditor'
import {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import {InMemoryWorldStudioRepository} from '../../../../data/world-studio/InMemoryWorldStudioRepository'
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
