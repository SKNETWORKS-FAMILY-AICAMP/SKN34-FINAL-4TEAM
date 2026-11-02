// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createMockDb, InMemoryFeedbackRepository, InMemoryReadingRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../../../data/mock/InMemoryRepositories'
import { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { useNewWorkViewModel } from './useNewWorkViewModel'

afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('issue #33: a missing restore never produces a success toast',async()=>{
 const db=createMockDb()
 const u=new LibraryUseCase(new InMemoryWorkRepository(db),new InMemoryWorldRepository(db),new InMemoryReadingRepository(db),new InMemoryFeedbackRepository(db))
 const store=createAppStore({role:'user'})
 const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
 const messages:string[]=[]
 const listen=(e:Event)=>messages.push((e as CustomEvent<string>).detail)
 window.addEventListener('sf-toast',listen)
 vi.spyOn(window,'confirm').mockReturnValue(true)
 const {result}=renderHook(()=>useNewWorkViewModel(u),{wrapper})
 await waitFor(()=>expect(result.current.worlds).toBeDefined())
 await act(async()=>{await result.current.restore('missing',-1)})
 window.removeEventListener('sf-toast',listen)
 expect(messages).toEqual(['복원할 내 세계관 버전을 찾을 수 없어요'])
})
