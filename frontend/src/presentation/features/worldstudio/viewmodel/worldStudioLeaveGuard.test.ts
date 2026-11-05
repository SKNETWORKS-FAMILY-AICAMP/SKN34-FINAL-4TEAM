import {expect,it,vi} from 'vitest'
import {createWorldStudioLeaveGuard} from '../../presentation/features/worldstudio/viewmodel/worldStudioLeaveGuard'
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
