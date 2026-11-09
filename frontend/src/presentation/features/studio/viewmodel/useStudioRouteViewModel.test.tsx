// @vitest-environment jsdom
// CI integration: 구형 주소는 서버에서 받은 slug로만 해석한다.
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryReadingRecordRepository, InMemoryReadingRepository, InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useStudioRouteViewModel } from './useStudioRouteViewModel'

afterEach(cleanup)
it('resolves a received slug to its canonical UUID without treating nickname as ownership',async()=>{
  const db=createFixtureDb()
  db.works=[{...db.works[0],id:'b142427a-cd9d-4fdc-a40d-c9e553d87d30',slug:'old-link',canonical:true,mine:false}]
  const uc=new ReadingUseCase(new InMemoryWorkRepository(db),new InMemoryReadingRepository(db),new InMemoryReadingRecordRepository(db))
  const store=createAppStore({role:'user'})
  const wrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
  const {result}=renderHook(()=>useStudioRouteViewModel('old-link',uc),{wrapper})
  await waitFor(()=>expect(result.current.data?.work.id).toBe(db.works[0].id))
  expect(result.current.data?.work.mine).toBe(false)
})
