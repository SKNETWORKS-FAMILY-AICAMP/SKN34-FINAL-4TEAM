// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type {WorldStudioRepository} from '../../../../domain/repositories/WorldStudioRepository'
import {MemoryRouter,Route,Routes} from 'react-router'
import {useState,type ReactNode} from 'react'
import {RestoreContext} from '../../../shared/session/restoreContext'
import {SessionExpired} from '../../../../domain/repositories/ProfileRepository'
import {useWorldStudioViewModel} from './useWorldStudioViewModel'
import {WorldStudioUseCase} from '../../../../domain/usecases/WorldStudioUseCase'
import {InMemoryWorldStudioRepository} from '../../../../data/world-studio/InMemoryWorldStudioRepository'
afterEach(cleanup)
it.each([false,true])('waits for session restoration before loading world list and detail (denied=%s)',async denied=>{
 const repository:WorldStudioRepository=new InMemoryWorldStudioRepository(),useCase=new WorldStudioUseCase(repository)
 const world=await useCase.create('세계','')
 const list=vi.spyOn(repository,'listStudio'),read=vi.spyOn(repository,'read')
 let finishRestore!:()=>void
 function Wrapper({children}:{children:ReactNode}) {
  const [restoring,setRestoring]=useState(true)
  finishRestore=()=>setRestoring(false)
  return <RestoreContext.Provider value={restoring}><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter></RestoreContext.Provider>
 }
 const {result}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper:Wrapper})
 expect(list).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled()
 expect(result.current.busy).toBe(true);expect(result.current.error).toBe('');expect(result.current.editing).toBeNull()
 if(denied){list.mockRejectedValue(new SessionExpired('서버 로그인이 필요합니다.'));read.mockRejectedValue(new SessionExpired('서버 로그인이 필요합니다.'))}
 act(()=>finishRestore())
 await waitFor(()=>expect(result.current.busy).toBe(false))
 expect(list).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledWith(world.id,expect.any(AbortSignal))
 if(denied){expect(result.current.error).toContain('서버 로그인이 필요합니다.');expect(result.current.editing).toBeNull()}
 else {expect(result.current.editing?.id).toBe(world.id);expect(result.current.error).toBe('')}
})
it('cancels an outstanding save on leaving without installing its late result',async()=>{
 const repository:WorldStudioRepository=new InMemoryWorldStudioRepository(),useCase=new WorldStudioUseCase(repository)
 const world=await useCase.create('세계','')
 let signal:AbortSignal|undefined
 vi.spyOn(repository,'saveStudio').mockImplementation((_world,requestSignal)=>{signal=requestSignal;return new Promise((_resolve,reject)=>requestSignal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))})
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worldstudio/'+world.id]}><Routes><Route path="/worldstudio/:worldId" element={children}/></Routes></MemoryRouter>
 const {result,unmount}=renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})
 await waitFor(()=>expect(result.current.editing?.id).toBe(world.id))
 let request:Promise<void>|undefined
 act(()=>{request=result.current.save()})
 await waitFor(()=>expect(signal).toBeDefined())
 unmount();expect(signal?.aborted).toBe(true);await request
})
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
