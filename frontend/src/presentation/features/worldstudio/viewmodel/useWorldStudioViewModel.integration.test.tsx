// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {MemoryRouter,Route,Routes} from 'react-router'
import type {ReactNode} from 'react'
import {useWorldStudioViewModel} from './useWorldStudioViewModel'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import {InMemoryWorldStudioRepository} from '../../../../data/world-studio/InMemoryWorldStudioRepository'
afterEach(cleanup)
it('opens a world, adds and edits a card without touching server state',async()=>{
 const useCase=new WorldStudioUseCase(new InMemoryWorldStudioRepository())
 const world=await useCase.create('세계','')
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter>
 const {result}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})
 await waitFor(()=>expect(result.current.editing?.id).toBe(world.id))
 act(()=>result.current.addCard('object'))
 const id=result.current.selected
 act(()=>result.current.update(id,{title:'열쇠',text:'문을 연다'},{aliases:['금빛 열쇠'],tags:['보물']}))
 await act(()=>result.current.save())
 expect((await useCase.read(world.id)).settings[0]).toMatchObject({aliases:['금빛 열쇠'],tags:['보물'],item:{title:'열쇠',entityType:'object'}})
 expect(result.current.dirty).toBe(false)
})
