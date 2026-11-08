// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { createAppStore } from '../../app/store'
import { useAsyncData } from './useAsyncData'
import { sessionActions } from './session/sessionSlice'

const wrapper=({children}:{children:ReactNode})=><Provider store={createAppStore()}>{children}</Provider>
describe('API-backed read state (CI integration)',()=>{
  it('invalidates every read on logout even when caller deps stay the same',async()=>{
    const store=createAppStore({role:'user'})
    let finish:(data:string)=>void=()=>{}
    const stableWrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
    const {result}=renderHook(()=>useAsyncData(()=>store.getState().session.role?Promise.resolve('private'):new Promise<string>(done=>{finish=done}),[]),{wrapper:stableWrapper})
    await waitFor(()=>expect(result.current.data).toBe('private'))
    act(()=>{store.dispatch(sessionActions.logout())})
    expect(result.current.data).toBeUndefined()
    await act(async()=>finish('public'))
    expect(result.current.data).toBe('public')
  })
  it('never shows previous private data when the request scope changes',async()=>{
    let finish:(data:string)=>void=()=>{}
    const {result,rerender}=renderHook(({scope})=>useAsyncData(()=>scope==='owner'?Promise.resolve('private'):new Promise<string>(done=>{finish=done}),[scope]),{initialProps:{scope:'owner'},wrapper})
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
})
