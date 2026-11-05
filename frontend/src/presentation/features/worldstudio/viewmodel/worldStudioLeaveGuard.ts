import {createContext} from 'react'

/** 승인한 생성·열기 이동에만 한 번 확인을 생략한다. */
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
