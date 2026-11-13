import {expect,it,vi} from 'vitest'
import {createWorldStudioLeaveGuard} from './worldStudioLeaveGuard'
it('blocks every transition while dirty and preserves the draft on cancel',()=>{
 const confirm=vi.fn(()=>false),guard=createWorldStudioLeaveGuard(confirm)
 expect(guard.shouldBlock()).toBe(false)
 guard.setDirty(true)
 expect(guard.shouldBlock()).toBe(true)
 expect(guard.confirmBeforeAction()).toBe(false)
 expect(guard.shouldBlock()).toBe(true)
 expect(confirm).toHaveBeenCalledOnce()
})
it('permits only the approved creation navigation and clears permission on clean state',()=>{
 const guard=createWorldStudioLeaveGuard(()=>true)
 guard.setDirty(true)
 expect(guard.confirmBeforeAction()).toBe(true)
 guard.allowNextNavigation()
 expect(guard.shouldBlock()).toBe(false)
 expect(guard.shouldBlock()).toBe(true)
 guard.allowNextNavigation();guard.setDirty(false);guard.setDirty(true)
 expect(guard.shouldBlock()).toBe(true)
})
it('does not permit another navigation when creation fails before permission is granted',()=>{
 const guard=createWorldStudioLeaveGuard(()=>true)
 guard.setDirty(true)
 expect(guard.confirmBeforeAction()).toBe(true)
 expect(guard.shouldBlock()).toBe(true)
})

it('guards an unapplied relationship independently from the world edit state',()=>{
 const confirm=vi.fn(()=>false),guard=createWorldStudioLeaveGuard(confirm)
 guard.setRelationDirty(true)
 expect(guard.shouldBlock()).toBe(true)
 expect(guard.confirmBeforeAction()).toBe(false)
 guard.setDirty(true);guard.setRelationDirty(false)
 expect(guard.shouldBlock()).toBe(true)
 guard.setDirty(false);expect(guard.shouldBlock()).toBe(false)
 guard.setRelationDirty(true);guard.setDirty(false)
 expect(guard.shouldBlock()).toBe(true)
})

it('does not block a move inside the same screen (tab or query change) so unsaved input stays, but still blocks leaving the page',()=>{
 const guard=createWorldStudioLeaveGuard(()=>true)
 guard.setDirty(true);guard.setRelationDirty(true)
 const move=(from:string,to:string)=>({currentLocation:{pathname:from},nextLocation:{pathname:to}})
 expect(guard.shouldBlock(move('/worldstudio/qa','/worldstudio/qa'))).toBe(false) // ?tab= 만 바뀐 이동
 expect(guard.shouldBlock(move('/worldstudio/qa','/worldstudio/other'))).toBe(true)
 expect(guard.shouldBlock(move('/worldstudio/qa','/lib'))).toBe(true)
 guard.allowNextNavigation()
 expect(guard.shouldBlock(move('/worldstudio/qa','/worldstudio/qa'))).toBe(false) // 같은 화면 이동은 승인된 이동 권한을 쓰지 않는다
 expect(guard.shouldBlock(move('/worldstudio/qa','/worldstudio/other'))).toBe(false) // 남은 권한은 다음 화면 이탈에 쓴다
})
