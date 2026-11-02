// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import { newSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import type { WorldStudioRepository } from '../../../../domain/repositories/WorldStudioRepository'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { useWorldStudioViewModel } from './useWorldStudioViewModel'

afterEach(cleanup)
const world:StudioWorld={id:'world-a',name:'항구',description:'설명',version:1,settings:[],analysis:null}
function setup() {
 const repo:WorldStudioRepository={connect:vi.fn(async()=>{}),capabilities:vi.fn(async()=>({aiEnabled:true})),list:vi.fn(async()=>[]),listStudio:vi.fn(async()=>[world]),read:vi.fn(async()=>structuredClone(world)),create:vi.fn(async()=>world),save:vi.fn(async()=>{}),remove:vi.fn(async()=>{}),saveStudio:vi.fn(async(w)=>({...w,version:w.version+1})),analyze:vi.fn(async()=>world),approve:vi.fn(async()=>world)}
 const useCase=new WorldStudioUseCase(repo)
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worlds/world-a']}><Routes><Route path="/worlds/:worldId" element={children}/></Routes></MemoryRouter>
 return {repo,...renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})}
}

it('does not replace confirmed Wiki data until save resolves and prevents duplicate saves',async()=>{
 const {result,repo}=setup()
 await waitFor(()=>expect(result.current.saved?.id).toBe('world-a'))
 let finish:(w:StudioWorld)=>void=()=>{}
 vi.mocked(repo.saveStudio).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const s=newSetting();s.item.title='법칙';s.item.text='원문';s.item.authorText='원문'
 act(()=>result.current.patch({settings:[s]}))
 expect(result.current.saved?.settings).toEqual([])
 let pending:Promise<void>
 act(()=>{pending=result.current.save();result.current.save()})
 expect(repo.saveStudio).toHaveBeenCalledTimes(1)
 expect(result.current.saved?.settings).toEqual([])
 await act(async()=>{finish({...world,version:2,settings:[s]});await pending})
 expect(result.current.saved?.settings[0].item.id).toBe(s.item.id)
 expect(result.current.dirty).toBe(false)
})

it('preserves author edits and last confirmed data on conflict',async()=>{
 const {result,repo}=setup()
 await waitFor(()=>expect(result.current.saved?.id).toBe('world-a'))
 vi.mocked(repo.saveStudio).mockRejectedValue(new Error('다른 곳에서 변경되었습니다'))
 act(()=>result.current.patch({description:'편집한 내용'}))
 await act(async()=>{await result.current.save()})
 expect(result.current.editing?.description).toBe('편집한 내용')
 expect(result.current.saved?.description).toBe('설명')
 expect(result.current.dirty).toBe(true)
 expect(result.current.error).toBe('다른 곳에서 변경되었습니다')
 expect(repo.analyze).not.toHaveBeenCalled()
})

it('reopening the current world actually reloads it after a conflict',async()=>{
 const {result,repo}=setup()
 await waitFor(()=>expect(result.current.saved?.version).toBe(1))
 vi.mocked(repo.read).mockResolvedValue({...world,version:2})
 act(()=>{result.current.open('world-a')})
 await waitFor(()=>expect(result.current.saved?.version).toBe(2))
})
