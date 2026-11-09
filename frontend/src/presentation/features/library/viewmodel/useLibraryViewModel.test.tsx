// @vitest-environment jsdom
// CI integration only: API errors stay visible and unsupported saves never announce success.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryReadingRecordRepository, InMemoryReadingRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../../../data/mock/InMemoryRepositories'
import { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { StudioUseCase } from '../../../../domain/usecases/StudioUseCase'
import { AGGREGATE_WRITE_UNSUPPORTED } from '../../../../domain/repositories/WorkRepository'
import { useLibraryViewModel } from './useLibraryViewModel'

afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('exposes retryable failures and keeps a rejected publication sheet open',async()=>{
  const db=createFixtureDb(), store=createAppStore({role:'user'})
  const works=new InMemoryWorkRepository(db), worlds=new InMemoryWorldRepository(db), feedback=new InMemoryFeedbackRepository(db)
  const library=new LibraryUseCase(works,worlds,new InMemoryReadingRepository(db),feedback,new InMemoryReadingRecordRepository(db))
  const studio=new StudioUseCase(works,new InMemoryCreditRepository(db),feedback,worlds)
  vi.spyOn(library,'getWrite').mockRejectedValueOnce(new Error('연결 실패'))
  vi.spyOn(studio,'savePublishSettings').mockRejectedValue(new Error(AGGREGATE_WRITE_UNSUPPORTED))
  const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter initialEntries={['/lib?tab=write']}>{children}</MemoryRouter></Provider>
  const {result}=renderHook(()=>useLibraryViewModel(library,studio),{wrapper})
  await waitFor(()=>expect(result.current.isError).toBe(true))
  expect(result.current.data).toBeUndefined()
  act(()=>result.current.retry())
  await waitFor(()=>expect(result.current.data?.write?.mine.length).toBeGreaterThan(0))
  act(()=>result.current.data!.openPublish('starlight'))
  const version=store.getState().session.dataVersion
  await act(async()=>{
    expect(await result.current.data!.savePublish({vis:'모두',on:true,all:true,eps:[],kind:'자체 창작',ok:true})).toBe(false)
  })
  expect(result.current.data?.publishing?.id).toBe('starlight')
  expect(store.getState().session.dataVersion).toBe(version)
})
it('removes a reading record through the use case, refreshes the list and reports a failure without refreshing',async()=>{
  const db=createFixtureDb(), store=createAppStore({role:'user'}), records=new InMemoryReadingRecordRepository(db)
  const works=new InMemoryWorkRepository(db), worlds=new InMemoryWorldRepository(db), feedback=new InMemoryFeedbackRepository(db)
  const library=new LibraryUseCase(works,worlds,new InMemoryReadingRepository(db),feedback,records)
  const studio=new StudioUseCase(works,new InMemoryCreditRepository(db),feedback,worlds)
  const messages:string[]=[]
  const listen=(event:Event)=>messages.push((event as CustomEvent<string>).detail)
  window.addEventListener('sf-toast',listen)
  const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter initialEntries={['/lib']}>{children}</MemoryRouter></Provider>
  const {result}=renderHook(()=>useLibraryViewModel(library,studio),{wrapper})
  const recent=()=>result.current.data?.read?.recent.map(r=>r.work.id)
  await waitFor(()=>expect(recent()).toEqual(['guunmong','starlight']))
  const version=store.getState().session.dataVersion

  await act(async()=>{await result.current.data!.removeReading('guunmong')})
  await waitFor(()=>expect(recent()).toEqual(['starlight']))
  expect(store.getState().session.dataVersion).toBe(version+1)
  expect(messages).toEqual(['이어 읽기 기록을 지웠어요'])

  vi.spyOn(records,'remove').mockRejectedValueOnce(new Error('연결 실패'))
  await act(async()=>{await result.current.data!.removeReading('starlight')})
  expect(messages.at(-1)).toBe('연결 실패')
  expect(store.getState().session.dataVersion).toBe(version+1)
  expect(recent()).toEqual(['starlight'])
  window.removeEventListener('sf-toast',listen)
})
it('ignores a second removal while one is still in flight',async()=>{
  const db=createFixtureDb(), store=createAppStore({role:'user'}), records=new InMemoryReadingRecordRepository(db)
  const works=new InMemoryWorkRepository(db), worlds=new InMemoryWorldRepository(db), feedback=new InMemoryFeedbackRepository(db)
  const library=new LibraryUseCase(works,worlds,new InMemoryReadingRepository(db),feedback,records)
  const studio=new StudioUseCase(works,new InMemoryCreditRepository(db),feedback,worlds)
  let release=()=>{}
  const remove=vi.spyOn(records,'remove').mockImplementation(()=>new Promise<void>(resolve=>{release=resolve}))
  const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter initialEntries={['/lib']}>{children}</MemoryRouter></Provider>
  const {result}=renderHook(()=>useLibraryViewModel(library,studio),{wrapper})
  await waitFor(()=>expect(result.current.data?.read?.recent).toHaveLength(2))
  act(()=>{void result.current.data!.removeReading('guunmong');void result.current.data!.removeReading('starlight')})
  expect(remove).toHaveBeenCalledTimes(1)
  expect(result.current.data?.removing).toBe('guunmong')
  await act(async()=>{release()})
  await waitFor(()=>expect(result.current.data?.removing).toBeNull())
})
