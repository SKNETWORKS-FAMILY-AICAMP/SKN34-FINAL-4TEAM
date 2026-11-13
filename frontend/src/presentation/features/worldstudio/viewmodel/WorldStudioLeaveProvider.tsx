import {useEffect,useState,type ReactNode} from 'react'
import {useBlocker} from 'react-router'
import {createWorldStudioLeaveGuard,WorldStudioLeaveContext} from './worldStudioLeaveGuard'

export function WorldStudioLeaveProvider({children}:{children:ReactNode}) {
 const [guard]=useState(()=>createWorldStudioLeaveGuard(scope=>window.confirm(scope==='both'?'저장하지 않은 변경과 적용하지 않은 관계 입력이 있어요. 버리고 이동할까요?':scope==='relation'?'적용하지 않은 관계 입력이 있어요. 버릴까요?':'저장하지 않은 변경이 있어요. 이동할까요?')))
 const blocker=useBlocker(guard.shouldBlock)
 useEffect(()=>{
  if(blocker.state!=='blocked')return
  if(guard.confirmBeforeAction())blocker.proceed()
  else blocker.reset()
 },[blocker,guard])
 return <WorldStudioLeaveContext.Provider value={guard}>{children}</WorldStudioLeaveContext.Provider>
}
