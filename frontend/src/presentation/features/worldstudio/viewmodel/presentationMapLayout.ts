import type { MapNode } from './useWorldMapViewModel'

/** 발표용 지도의 고정 배치: 인물은 가운데 한 줄, 나머지는 타원 둘레. */
export function presentationMapLayout(nodes:MapNode[]) {
 const people=nodes.filter(n=>n.kind==='인물'),others=nodes.filter(n=>n.kind!=='인물')
 return nodes.map(node=>{
  const person=node.kind==='인물',group=person?people:others,i=group.indexOf(node),count=group.length
  const angle=i*Math.PI*2/Math.max(count,1)-Math.PI/2
  const x=person?(i-(count-1)/2)*160:Math.cos(angle)*(360+(i%2)*65)
  const y=person?(i%2?55:-40):Math.sin(angle)*(210+(i%2)*50)
  return {...node,x,y,fx:x,fy:y}
 })
}
