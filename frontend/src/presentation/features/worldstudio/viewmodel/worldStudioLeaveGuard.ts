import {createContext} from 'react'

export function createWorldStudioLeaveGuard(confirm:()=>boolean) {
 let dirty=false,allowOnce=false
 return {
  setDirty(value:boolean){dirty=value;if(!value)allowOnce=false},
  confirmBeforeAction(){return !dirty||confirm()},
  allowNextNavigation(){if(dirty)allowOnce=true},
  shouldBlock(){if(allowOnce){allowOnce=false;return false}return dirty},
 }
}
export type WorldStudioLeaveGuard=ReturnType<typeof createWorldStudioLeaveGuard>

export const WorldStudioLeaveContext=createContext<WorldStudioLeaveGuard|null>(null)
