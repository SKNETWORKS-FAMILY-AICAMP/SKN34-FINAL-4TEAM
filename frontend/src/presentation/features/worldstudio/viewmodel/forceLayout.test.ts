import { afterEach, expect, it, vi } from 'vitest'
import { CARD_H, CARD_W } from './canvasLayout'
import { forceLayout } from './forceLayout'
afterEach(()=>vi.restoreAllMocks())

const ids=(n:number,prefix='n')=>Array.from({length:n},(_,i)=>({id:prefix+i}))
const ring=(n:number)=>Array.from({length:n},(_,i)=>({source:'n'+i,target:'n'+((i+1)%n)}))
const center=(p:{x:number;y:number})=>({x:p.x+CARD_W/2,y:p.y+CARD_H/2})
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)

it('같은 입력에는 늘 같은 자리를 주고(난수·시간에 기대지 않는다) 모든 카드에 유한한 좌표가 있다',()=>{
 vi.spyOn(Math,'random').mockImplementation(()=>{throw new Error('Math.random을 쓰면 안 된다')})
 const nodes=ids(40),links=[...ring(40),{source:'n0',target:'n20'},{source:'n5',target:'n30'}]
 const a=forceLayout(nodes,links),b=forceLayout(nodes,links)
 expect([...b]).toEqual([...a])
 expect(a.size).toBe(40)
 for(const p of a.values()){expect(Number.isFinite(p.x)&&Number.isFinite(p.y)).toBe(true)}
})

it('카드 상자(200×150)가 서로 겹치지 않는다: 이어진 카드·외톨이 카드 모두',()=>{
 const nodes=[...ids(36),...ids(8,'solo')],links=[...ring(36),{source:'n0',target:'n18'},{source:'n3',target:'n12'},{source:'n7',target:'n30'}]
 const spots=[...forceLayout(nodes,links).values()]
 for(let i=0;i<spots.length;i++)for(let j=i+1;j<spots.length;j++){
  expect(Math.abs(spots[i].x-spots[j].x)>=CARD_W||Math.abs(spots[i].y-spots[j].y)>=CARD_H).toBe(true)
 }
})

it('관계로 이어진 카드끼리는 가깝고 서로 이어지지 않은 무리는 멀다(두 무리의 평균 거리 비교)',()=>{
 const group=(prefix:string)=>ids(6,prefix),links=(prefix:string)=>group(prefix).flatMap((a,i,all)=>all.slice(i+1).map(b=>({source:a.id,target:b.id})))
 const nodes=[...group('a'),...group('b')],placed=forceLayout(nodes,[...links('a'),...links('b')])
 const spot=(id:string)=>center(placed.get(id)!)
 const inside:number[]=[],across:number[]=[]
 for(const a of nodes)for(const b of nodes){if(a.id>=b.id)continue;(a.id[0]===b.id[0]?inside:across).push(dist(spot(a.id),spot(b.id)))}
 const mean=(xs:number[])=>xs.reduce((s,x)=>s+x,0)/xs.length
 expect(mean(inside)).toBeLessThan(mean(across))
})

it('전체가 원점 둘레에 모이고(중심 힘) 없는 카드나 자기 자신으로 가는 관계는 무시하며 빈 입력은 빈 결과다',()=>{
 const nodes=ids(12),placed=forceLayout(nodes,[...ring(12),{source:'n0',target:'없는 카드'},{source:'n1',target:'n1'}])
 expect(placed.size).toBe(12)
 const cs=[...placed.values()].map(center),mx=cs.reduce((s,p)=>s+p.x,0)/cs.length,my=cs.reduce((s,p)=>s+p.y,0)/cs.length
 expect(Math.abs(mx)).toBeLessThan(5);expect(Math.abs(my)).toBeLessThan(5)
 expect(forceLayout([],[]).size).toBe(0)
 expect(center(forceLayout([{id:'only'}],[]).get('only')!)).toEqual({x:0,y:0})
})
