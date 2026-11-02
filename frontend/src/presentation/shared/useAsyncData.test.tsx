// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Provider } from 'react-redux'
import type { ReactNode } from 'react'
import { createAppStore } from '../../app/store'
import { sessionActions } from './session/sessionSlice'
import { useAsyncData } from './useAsyncData'
afterEach(cleanup)

it('issue #29: hides previous target while a new target loads or fails',async()=>{
 const store=createAppStore()
 const wrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
 let reject:(e:Error)=>void=()=>{}
 const {result,rerender}=renderHook(({id})=>useAsyncData(()=>id==='a'?Promise.resolve('world a'):new Promise<string>((_,r)=>{reject=r}),[id]),{initialProps:{id:'a'},wrapper})
 await waitFor(()=>expect(result.current.data).toBe('world a'))
 rerender({id:'b'})
 expect(result.current).toMatchObject({data:undefined,isLoading:true,isError:false})
 await act(async()=>reject(new Error('not found')))
 expect(result.current).toMatchObject({data:undefined,isLoading:false,isError:true})
})

it('issue #29: retains current target during dataVersion refresh',async()=>{
 const store=createAppStore()
 const wrapper=({children}:{children:ReactNode})=><Provider store={store}>{children}</Provider>
 let first=true
 const {result}=renderHook(()=>useAsyncData(()=>{if(first){first=false;return Promise.resolve('saved')};return new Promise<string>(()=>{})},['same']),{wrapper})
 await waitFor(()=>expect(result.current.data).toBe('saved'))
 act(()=>{store.dispatch(sessionActions.dataChanged())})
 expect(result.current.data).toBe('saved')
})
