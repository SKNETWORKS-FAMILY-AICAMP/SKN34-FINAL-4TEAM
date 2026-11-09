// @vitest-environment jsdom
// CI integration: 저장 실패 시 양식·주소를 유지하고 성공 상태를 만들지 않는다.
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryFeedbackRepository, InMemoryReadingRecordRepository, InMemoryReadingRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../../../data/mock/InMemoryRepositories'
import { AGGREGATE_WRITE_UNSUPPORTED } from '../../../../domain/repositories/WorkRepository'
import { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { useNewWorkViewModel } from './useNewWorkViewModel'
import { useImportViewModel } from './useImportViewModel'

afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('handles unsupported create/import without clearing entered values or claiming success',async()=>{
  const db=createFixtureDb(),store=createAppStore({role:'user'})
  const uc=new LibraryUseCase(new InMemoryWorkRepository(db),new InMemoryWorldRepository(db),new InMemoryReadingRepository(db),new InMemoryFeedbackRepository(db),new InMemoryReadingRecordRepository(db))
  vi.spyOn(uc,'createWork').mockRejectedValue(new Error(AGGREGATE_WRITE_UNSUPPORTED))
  vi.spyOn(uc,'saveImport').mockRejectedValue(new Error(AGGREGATE_WRITE_UNSUPPORTED))
  const messages:string[]=[]
  const listen=(event:Event)=>messages.push((event as CustomEvent<string>).detail)
  window.addEventListener('sf-toast',listen)
  try {
    const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
    const {result}=renderHook(()=>({newWork:useNewWorkViewModel(uc),importer:useImportViewModel(uc)}),{wrapper})
    await act(async()=>{})
    act(()=>result.current.newWork.set({title:'입력한 제목'}))
    const before=store.getState()
    await act(async()=>{await result.current.newWork.create();await result.current.importer.save()})
    expect(result.current.newWork.form.title).toBe('입력한 제목')
    expect(store.getState().newWork).toEqual(before.newWork)
    expect(store.getState().import).toEqual(before.import)
    expect(store.getState().session.dataVersion).toBe(before.session.dataVersion)
    expect(messages).toEqual([AGGREGATE_WRITE_UNSUPPORTED,AGGREGATE_WRITE_UNSUPPORTED])
  } finally {window.removeEventListener('sf-toast',listen)}
})
