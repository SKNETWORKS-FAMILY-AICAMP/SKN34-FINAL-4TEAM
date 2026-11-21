import { afterEach, expect, it, vi } from 'vitest'
import { CARD_H, CARD_W, GAP } from './canvasLayout'
import { forceLayout } from './forceLayout'
import { degrees, dotDiameter } from './zoomLevel'
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

/** 시연 크기의 가짜 그래프: 57노드·142링크, 고정 시드 난수로 허브 몇 개에 링크가 몰리고 나머지는 흩어진다(실측 세계관과 같은 규모). */
function demoGraph(){
 let seed=20241121
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
 const nodes=ids(57,'d'),links:{source:string;target:string}[]=[]
 while(links.length<142){
  const a=random()<0.45?Math.floor(random()*5):Math.floor(random()*57) // 앞 다섯은 허브
  const b=Math.floor(random()*57)
  if(a!==b)links.push({source:'d'+a,target:'d'+b})
 }
 return {nodes,links}
}

it('시연 크기(57노드·142링크)에서 가까이(near) 카드 사각형이 간격(16px)까지 겹치지 않고, 멀리·중간의 점(지름)도 서로 겹치지 않으며, 같은 입력은 같은 자리다',()=>{
 const {nodes,links}=demoGraph()
 const placed=forceLayout(nodes,links),again=forceLayout(nodes,links)
 expect([...again]).toEqual([...placed])
 expect(placed.size).toBe(57)
 const degree=degrees(nodes.map(n=>n.id),links),max=Math.max(...degree.values())
 const body=nodes.map(n=>{const p=placed.get(n.id)!,d=dotDiameter(degree.get(n.id)??0,max);return {id:n.id,cx:p.x+CARD_W/2,cy:p.y+CARD_H/2,d}})
 for(let i=0;i<body.length;i++)for(let j=i+1;j<body.length;j++){
  const a=body[i],b=body[j],dx=Math.abs(a.cx-b.cx),dy=Math.abs(a.cy-b.cy)
  expect(dx>=CARD_W+GAP||dy>=CARD_H+GAP,'카드 '+a.id+'·'+b.id).toBe(true) // 가까이: 카드 상자
  expect(Math.hypot(dx,dy)>=(a.d+b.d)/2,'점 '+a.id+'·'+b.id).toBe(true) // 멀리·중간: 점(원)
  expect(dx>=(Math.max(CARD_W,a.d)+Math.max(CARD_W,b.d))/2+GAP||dy>=(Math.max(CARD_H,a.d)+Math.max(CARD_H,b.d))/2+GAP,'큰 점 '+a.id+'·'+b.id).toBe(true) // 허브의 큰 점(지름 200)이 카드 높이를 넘어도 이웃과 겹치지 않는다
 }
})

it('카드가 많아도(200장) 겹침이 0이다(마무리 패스가 남은 겹침을 가까운 빈 자리로 민다)',()=>{
 const nodes=ids(200,'m'),links=Array.from({length:300},(_,i)=>({source:'m'+(i*7%200),target:'m'+((i*13+5)%200)})).filter(l=>l.source!==l.target)
 const placed=forceLayout(nodes,links),spots=nodes.map(n=>placed.get(n.id)!)
 for(let i=0;i<spots.length;i++)for(let j=i+1;j<spots.length;j++)expect(Math.abs(spots[i].x-spots[j].x)>=CARD_W+GAP||Math.abs(spots[i].y-spots[j].y)>=CARD_H+GAP).toBe(true)
})
