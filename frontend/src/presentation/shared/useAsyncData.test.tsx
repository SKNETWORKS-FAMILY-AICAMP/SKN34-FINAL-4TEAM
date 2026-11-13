// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../app/store'
import { useAsyncData } from './useAsyncData'
import { sessionActions } from './session/sessionSlice'

const wrapper=({children}:{children:ReactNode})=><Provider store={createAppStore()}>{children}</Provider>
afterEach(cleanup)
describe('API-backed read state (CI integration)',()=>{
  it('invalidates every read on logout even when caller deps stay the same',async()=>{
    const store=createAppStore({role:'user'})
    // load는 effect 다음 microtask에 호출되므로 응답 Promise를 먼저 만들어 둔다(호출 시점과 무관하게 finish가 닿는다).
    let finish:(data:string)=>void=()=>{}
    const pending=new Promise<string>(done=>{finish=done})
    const stableWrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
    const {result}=renderHook(()=>useAsyncData(()=>store.getState().session.role?Promise.resolve('private'):pending,[]),{wrapper:stableWrapper})
    await waitFor(()=>expect(result.current.data).toBe('private'))
    act(()=>{store.dispatch(sessionActions.logout())})
    expect(result.current.data).toBeUndefined()
    await act(async()=>finish('public'))
    expect(result.current.data).toBe('public')
  })
  it('never shows previous private data when the request scope changes',async()=>{
    let finish:(data:string)=>void=()=>{}
    const pending=new Promise<string>(done=>{finish=done})
    const {result,rerender}=renderHook(({scope})=>useAsyncData(()=>scope==='owner'?Promise.resolve('private'):pending,[scope]),{initialProps:{scope:'owner'},wrapper})
    await waitFor(()=>expect(result.current.data).toBe('private'))
    rerender({scope:'anonymous'})
    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
    await act(async()=>finish('public'))
    expect(result.current.data).toBe('public')
  })
  it('exposes a real failed request and retries without sample fallback',async()=>{
    let fail=true
    const {result}=renderHook(()=>useAsyncData(()=>fail?Promise.reject(new Error('offline')):Promise.resolve('API data'),[]),{wrapper})
    await waitFor(()=>expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    fail=false
    act(()=>result.current.retry())
    await waitFor(()=>expect(result.current.data).toBe('API data'))
  })
  it('keeps previous data while the same scope refreshes after a data change',async()=>{
    const store=createAppStore()
    let finish:(data:string)=>void=()=>{}
    const load=vi.fn<()=>Promise<string>>().mockResolvedValueOnce('기존').mockImplementationOnce(()=>new Promise<string>(done=>{finish=done}))
    const stableWrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
    const {result}=renderHook(()=>useAsyncData(load,[load]),{wrapper:stableWrapper})
    await waitFor(()=>expect(result.current.data).toBe('기존'))
    act(()=>{store.dispatch(sessionActions.dataChanged())})
    await waitFor(()=>expect(result.current.isRefreshing).toBe(true))
    expect(result.current.data).toBe('기존')
    await act(async()=>finish('새 데이터'))
    expect(result.current.data).toBe('새 데이터')
    expect(result.current.isRefreshing).toBe(false)
  })
  it('cancels the previous request when the scope changes and the pending one when the screen unmounts',async()=>{
    const signals:AbortSignal[]=[]
    const {rerender,unmount}=renderHook(({scope})=>useAsyncData((signal)=>{signals.push(signal);return new Promise<string>(()=>{})},[scope]),{initialProps:{scope:'a'},wrapper})
    await waitFor(()=>expect(signals).toHaveLength(1))
    expect(signals[0].aborted).toBe(false)
    rerender({scope:'b'})
    await waitFor(()=>expect(signals).toHaveLength(2))
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    unmount()
    expect(signals[1].aborted).toBe(true)
  })
  it('re-reads in place when only refresh values change, but hides data when the scope changes',async()=>{
    let finish:(data:string)=>void=()=>{}
    const pending=new Promise<string>(done=>{finish=done})
    const load=vi.fn((work:string,tab:string)=>tab==='write'?pending:Promise.resolve(`${work}:${tab}`))
    const store=createAppStore()
    const stableWrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
    const {result,rerender}=renderHook(({work,tab})=>useAsyncData(()=>load(work,tab),[work],[tab]),{initialProps:{work:'작품1',tab:'wiki'},wrapper:stableWrapper})
    await waitFor(()=>expect(result.current.data).toBe('작품1:wiki'))
    rerender({work:'작품1',tab:'write'})
    expect(result.current.data).toBe('작품1:wiki')
    await waitFor(()=>expect(result.current.isRefreshing).toBe(true))
    await act(async()=>finish('작품1:write'))
    expect(result.current.data).toBe('작품1:write')
    expect(result.current.isRefreshing).toBe(false)
    rerender({work:'작품2',tab:'write'})
    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })
})
it('재조회 중 이전 성공 데이터를 유지하고 실패·재시도·복구를 구분한다 (CI 통합)', async () => {
  const store = createAppStore()
  const load = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(['기존 데이터']).mockRejectedValueOnce(new Error('실패')).mockResolvedValue(['새 데이터'])
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  const { result } = renderHook(() => useAsyncData(load, [load]), { wrapper })
  await waitFor(() => expect(result.current.data).toEqual(['기존 데이터']))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.data).toEqual(['기존 데이터'])
  expect(result.current.isLoading).toBe(false)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.data).toEqual(['새 데이터']))
  expect(result.current.isError).toBe(false)
  expect(result.current.isRefreshing).toBe(false)
})
