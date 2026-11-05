import {useEffect,useState,type ReactNode} from 'react'
import {useBlocker} from 'react-router'
import {createWorldStudioLeaveGuard,WorldStudioLeaveContext} from './worldStudioLeaveGuard'

export function WorldStudioLeaveProvider({children}:{children:ReactNode}) {
 const [guard]=useState(()=>createWorldStudioLeaveGuard(()=>window.confirm('저장하지 않은 변경이 있습니다. 이동할까요?')))
 const blocker=useBlocker(guard.shouldBlock)
 useEffect(()=>{
  if(blocker.state!=='blocked')return
  if(guard.confirmBeforeAction())blocker.proceed()
  else blocker.reset()
 },[blocker,guard])
 return <WorldStudioLeaveContext.Provider value={guard}>{children}</WorldStudioLeaveContext.Provider>
}
