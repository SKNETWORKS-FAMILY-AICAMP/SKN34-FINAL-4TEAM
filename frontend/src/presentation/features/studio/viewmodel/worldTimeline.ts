import type { SettingItem } from '../../../../domain/entities/studioWorld'

export function timelineLayout(items:SettingItem[]) {
 const events=items.filter(i=>i.kind==='event'&&i.decision==='approved')
 const byId=new Map(events.map(i=>[i.id,i]))
 const depth=(id:string,visited=new Set<string>()):number=>{
  const item=byId.get(id)
  if(!item?.afterId||!byId.has(item.afterId)||visited.has(id))return 0
  return 1+depth(item.afterId,new Set([...visited,id]))
 }
 const rows=new Map<number,number>()
 return events.map(item=>{const column=depth(item.id),row=rows.get(column)??0;rows.set(column,row+1);return {item,column,row}})
}
