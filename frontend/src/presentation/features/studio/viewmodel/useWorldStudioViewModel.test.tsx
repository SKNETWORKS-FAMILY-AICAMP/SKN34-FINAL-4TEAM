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
function setup(initialWorld:StudioWorld=world) {
 const repo:WorldStudioRepository={connect:vi.fn(async()=>{}),capabilities:vi.fn(async()=>({aiEnabled:true})),list:vi.fn(async()=>[]),listStudio:vi.fn(async()=>[initialWorld]),read:vi.fn(async()=>structuredClone(initialWorld)),create:vi.fn(async()=>world),save:vi.fn(async()=>{}),remove:vi.fn(async()=>{}),saveStudio:vi.fn(async(w)=>({...w,version:w.version+1})),analyze:vi.fn(async()=>world),approve:vi.fn(async()=>world)}
 const useCase=new WorldStudioUseCase(repo)
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/worlds/world-a']}><Routes><Route path="/worlds/:worldId" element={children}/></Routes></MemoryRouter>
 return {repo,...renderHook(()=>useWorldStudioViewModel(useCase),{wrapper})}
}

it('restores the original clean save state when undoing the only deletion',async()=>{
 const p=newSetting('people');p.item.title='저장된 인물'
 const {result}=setup({...world,settings:[p]})
 await waitFor(()=>expect(result.current.saved).not.toBeNull())
 act(()=>result.current.deletePerson(p.item.id))
 expect(result.current.dirty).toBe(true)
 act(()=>result.current.undoPersonDeletion())
 expect(result.current.dirty).toBe(false)
 expect(result.current.editing!.settings.map(s=>s.item.id)).toEqual([p.item.id])
})

it('undoes a person deletion only before further editing or saving and keeps a failed save draft',async()=>{
 const {result,repo}=setup()
 await waitFor(()=>expect(result.current.editing).not.toBeNull())
 const p=newSetting('people');p.item.title='삭제 테스트'
 act(()=>result.current.patch({settings:[p]}))
 act(()=>result.current.deletePerson(p.item.id))
 expect(result.current.editing!.settings).toHaveLength(0)
 expect(result.current.canUndoPersonDeletion).toBe(true)
 act(()=>result.current.undoPersonDeletion())
 expect(result.current.editing!.settings[0].item.id).toBe(p.item.id)
 act(()=>result.current.deletePerson(p.item.id))
 act(()=>result.current.patch({description:'삭제 뒤 새 편집'}))
 expect(result.current.canUndoPersonDeletion).toBe(false)
 act(()=>result.current.undoPersonDeletion())
 expect(result.current.editing!.description).toBe('삭제 뒤 새 편집')
 expect(result.current.editing!.settings).toHaveLength(0)
 vi.mocked(repo.saveStudio).mockRejectedValueOnce(new Error('저장 실패'))
 await act(async()=>{await result.current.save()})
 expect(result.current.dirty).toBe(true)
 expect(result.current.editing!.settings).toHaveLength(0)
})

it('shares character and directed relationship edits with the normal save and preserves them on conflict',async()=>{
 const {result,repo}=setup()
 await waitFor(()=>expect(result.current.editing?.id).toBe('world-a'))
 let a='',b=''
 act(()=>{a=result.current.add('people')!})
 act(()=>result.current.update(a,{title:'가람'}))
 act(()=>{b=result.current.add('people')!})
 act(()=>result.current.update(b,{title:'나래'}))
 act(()=>result.current.putRelation({subjectId:a,targetId:b,predicate:'trusts',polarity:'asserted'}))
 const relation=result.current.editing!.settings[2].item
 expect(result.current.saved!.settings).toHaveLength(0)
 act(()=>result.current.putRelation({...relation,polarity:'denied'}))
 expect(result.current.editing!.settings[2].item.id).toBe(relation.id)
 vi.mocked(repo.saveStudio).mockRejectedValueOnce(new Error('버전 충돌'))
 await act(async()=>{await result.current.save()})
 expect(result.current.editing!.settings).toHaveLength(3)
 expect(result.current.error).toBe('버전 충돌')
 await act(async()=>{await result.current.save()})
 expect(result.current.saved!.settings[2].item.polarity).toBe('denied')
 act(()=>result.current.removeRelation(relation.id))
 await act(async()=>{await result.current.save()})
 expect(result.current.saved!.settings.map(s=>s.item.id)).toEqual([a,b])
})

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
 expect(result.current.saveState).toBe('saving')
 expect(result.current.saved?.settings).toEqual([])
 await act(async()=>{finish({...world,version:2,settings:[s]});await pending})
 expect(result.current.saved?.settings[0].item.id).toBe(s.item.id)
 expect(result.current.dirty).toBe(false)
 expect(result.current.saveState).toBe('idle')
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
 expect(result.current.saveState).toBe('failed')
 expect(repo.analyze).not.toHaveBeenCalled()
})

it('reopening the current world actually reloads it after a conflict',async()=>{
 const {result,repo}=setup()
 await waitFor(()=>expect(result.current.saved?.version).toBe(1))
 vi.mocked(repo.read).mockResolvedValue({...world,version:2})
 act(()=>{result.current.open('world-a')})
 await waitFor(()=>expect(result.current.saved?.version).toBe(2))
})
