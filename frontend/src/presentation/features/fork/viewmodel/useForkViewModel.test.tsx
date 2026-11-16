// @vitest-environment jsdom
// React/Hook 조립은 CI integration에서만 실행한다.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { ForkUseCase } from '../../../../domain/usecases/ForkUseCase'
import { useForkViewModel } from './useForkViewModel'

afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('does not announce success or mutate the new screen after leaving a pending Fork form',async()=>{
  const uc=new ForkUseCase(new InMemoryWorkRepository(createFixtureDb()))
  let done:(result:{id:string})=>void=()=>{}
  vi.spyOn(uc,'startFork').mockImplementation(()=>new Promise(resolve=>{done=resolve}))
  const store=createAppStore({role:'user'})
  const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const {result,unmount}=renderHook(()=>useForkViewModel('guunmong',2,uc),{wrapper})
  await waitFor(()=>expect(result.current.form?.work.id).toBe('guunmong'))
  const version=store.getState().session.dataVersion
  let pending:Promise<void>=Promise.resolve()
  act(()=>{pending=result.current.start()})
  unmount()
  await act(async()=>{done({id:'server-created'});await pending})
  expect(store.getState().session.dataVersion).toBe(version)
})
it('keeps input, reports a real failure and releases duplicate-submit protection',async()=>{
  const uc=new ForkUseCase(new InMemoryWorkRepository(createFixtureDb()))
  let reject:(error:Error)=>void=()=>{}
  const send=vi.spyOn(uc,'startFork').mockImplementationOnce(()=>new Promise((_done,fail)=>{reject=fail})).mockResolvedValue({error:'서버 거부'})
  const store=createAppStore({role:'user'})
  const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const {result}=renderHook(()=>useForkViewModel('guunmong',2,uc),{wrapper})
  await waitFor(()=>expect(result.current.form?.work.id).toBe('guunmong'))
  act(()=>{result.current.setDir('다른 선택');result.current.setTitle('나의 포크')})
  let pending:Promise<void>=Promise.resolve()
  act(()=>{pending=result.current.start();void result.current.start()})
  expect(send).toHaveBeenCalledTimes(1)
  expect(result.current.submitting).toBe(true)
  await act(async()=>{reject(new Error('연결 실패'));await pending})
  expect(result.current.error).toBe('연결 실패')
  expect(result.current.dir).toBe('다른 선택')
  expect(result.current.title).toBe('나의 포크')
  expect(result.current.submitting).toBe(false)
  await act(async()=>{await result.current.start()})
  expect(send).toHaveBeenCalledTimes(2)
  expect(result.current.error).toBe('서버 거부')
})
it('clears the picked episode when the server answers with another one so later reads follow the server',async()=>{
  const uc=new ForkUseCase(new InMemoryWorkRepository(createFixtureDb()))
  const real=uc.getForm.bind(uc)
  // 서버가 3화를 허용하지 않아 2화로 바꿔 답하는 상황
  const getForm=vi.spyOn(uc,'getForm').mockImplementation((id,at)=>real(id,at===3?2:at))
  const store=createAppStore({role:'user'})
  const wrapper=({children}:{children:ReactNode})=><Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const {result}=renderHook(()=>useForkViewModel('guunmong',2,uc),{wrapper})
  await waitFor(()=>expect(result.current.at).toBe(2))
  act(()=>{result.current.pick(3)})
  await waitFor(()=>expect(getForm).toHaveBeenCalledWith('guunmong',3))
  // 고른 값이 지워져 이후 조회는 고른 3화가 아니라 처음 주소의 회차를 따른다(재조회 중 3화로 깜빡이지 않는다).
  await waitFor(()=>expect(getForm).toHaveBeenLastCalledWith('guunmong',2))
  expect(result.current.at).toBe(2)
})
