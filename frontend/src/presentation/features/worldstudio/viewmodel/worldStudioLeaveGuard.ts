import {createContext} from 'react'

/** 승인한 생성·열기 이동에만 한 번 확인을 생략한다. */
export function createWorldStudioLeaveGuard(confirm:(scope:'world'|'relation'|'both')=>boolean) {
 let dirty=false,relationDirty=false,allowOnce=false
 const hasChanges=()=>dirty||relationDirty
 return {
  setDirty(value:boolean){dirty=value;if(!hasChanges())allowOnce=false},
  setRelationDirty(value:boolean){relationDirty=value;if(!hasChanges())allowOnce=false},
  confirmBeforeAction(){return !hasChanges()||confirm(dirty&&relationDirty?'both':relationDirty?'relation':'world')},
  confirmRelationDiscard(){return !relationDirty||confirm('relation')},
  allowNextNavigation(){if(hasChanges())allowOnce=true},
  /** 같은 화면 안의 이동(탭·검색어 등 주소의 쿼리만 바뀜)은 입력을 잃지 않으므로 막지 않고 승인된 이동 권한도 쓰지 않는다. */
  shouldBlock(move?:{currentLocation:{pathname:string};nextLocation:{pathname:string}}){
   if(move&&move.currentLocation.pathname===move.nextLocation.pathname)return false
   if(allowOnce){allowOnce=false;return false}
   return hasChanges()
  },
 }
}
export type WorldStudioLeaveGuard=ReturnType<typeof createWorldStudioLeaveGuard>

export const WorldStudioLeaveContext=createContext<WorldStudioLeaveGuard|null>(null)
