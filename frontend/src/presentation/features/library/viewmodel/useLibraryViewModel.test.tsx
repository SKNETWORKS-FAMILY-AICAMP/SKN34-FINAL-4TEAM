// @vitest-environment jsdom
// CI integration only: API errors stay visible and unsupported saves never announce success.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryReadingRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../../../data/mock/InMemoryRepositories'
import { InMemoryWorkInterestRepository } from '../../../../data/mock/InMemoryWorkInterestRepository'
import { LibraryUseCase } from '../../../../domain/usecases/LibraryUseCase'
import { StudioUseCase } from '../../../../domain/usecases/StudioUseCase'
import { AGGREGATE_WRITE_UNSUPPORTED } from '../../../../domain/repositories/WorkRepository'
import { useLibraryViewModel } from './useLibraryViewModel'

afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('exposes retryable failures and keeps a rejected publication sheet open',async()=>{
  const db=createFixtureDb(), store=createAppStore({role:'user'})
  const works=new InMemoryWorkRepository(db), worlds=new InMemoryWorldRepository(db), feedback=new InMemoryFeedbackRepository(db)
  const library=new LibraryUseCase(works,worlds,new InMemoryReadingRepository(db),feedback,new InMemoryWorkInterestRepository())
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
