import { expect, it } from 'vitest'
import { HONGGILDONG_CARDS, HONGGILDONG_LINKS } from '../../../../test/honggildongGraph'
import { CARD_H, CARD_W } from './canvasLayout'
import { forceLayout } from './forceLayout'
import { labelSize, labelWidth, placeLabels, type LabelNode } from './labelLayout'
import { degrees, dotDiameter, labelLimit, topDegreeIds } from './zoomLevel'

const node=(id:string,cx:number,cy:number,d=44,degree=1,name=id):LabelNode=>({id,cx,cy,d,degree,name})
const view={x:0,y:0,k:1,w:800,h:600}
const ids=(list:{id:string}[])=>list.map(l=>l.id)
const all=(...nodes:LabelNode[])=>new Set(nodes.map(n=>n.id))

it('이름표는 노드 바로 아래 화면 4px에 놓이고 글자는 확대 배율과 상관없이 화면 12px 이상이다(큰 노드는 13·14px)',()=>{
 const a=node('a',200,200,44)
 expect(placeLabels([a],view,all(a),new Set())).toEqual([{id:'a',x:200,y:200+22+4,size:12}])
 const far=placeLabels([a],{...view,x:100,y:50,k:0.1},all(a),new Set())[0] // 멀리: 점은 4.4px이지만 이름표는 그대로 12px, 점 바로 아래 4px
 expect(far.size).toBe(12)
 expect(far.x).toBeCloseTo(200*0.1+100,5)
 expect(far.y).toBeCloseTo(200*0.1+50+22*0.1+4,5)
 expect([44,79,80,119,120,200].map(labelSize)).toEqual([12,12,13,13,14,14])
 for(const k of [0.05,0.2,0.5,0.9,1.75])expect(placeLabels([a],{x:0,y:0,k,w:4000,h:4000},all(a),new Set())[0]?.size,'k='+k).toBeGreaterThanOrEqual(12)
})

it('labelWidth는 한글을 글자당 한 칸(글자 크기)으로, 영문·숫자를 약 0.56칸으로 어림한다',()=>{
 expect(labelWidth('가람',12)).toBe(24)
 expect(labelWidth('abcd',12)).toBeCloseTo(4*0.56*12,5)
 expect(labelWidth('가a',10)).toBeCloseTo(10+5.6,5)
})

it('이름표 상자가 겹치면 관계가 적은 쪽(큰 노드 우선)의 이름을 숨기고, 같으면 앞선 노드가 남는다',()=>{
 const a=node('a',200,200,44,1),b=node('b',210,200,44,5)
 expect(ids(placeLabels([a,b],view,all(a,b),new Set()))).toEqual(['b'])
 const c=node('c',200,200,44,3),d=node('d',210,200,44,3)
 expect(ids(placeLabels([c,d],view,all(c,d),new Set()))).toEqual(['c'])
 const far=node('f',600,400,44,1)
 expect(ids(placeLabels([a,b,far],view,all(a,b,far),new Set())).sort()).toEqual(['b','f']) // 떨어진 노드는 각자 보인다
})

it('이름표는 다른 노드의 점을 가려도 숨기지 않는다(점 위에 글자가 올라가도 읽힌다): 가리는 것은 이름표끼리만 가른다',()=>{
 const a=node('a',200,100,44,9),b=node('b',200,135,44,1) // a의 이름표(위 126~142)가 b의 점(113~157)을 가린다
 expect(ids(placeLabels([a,b],view,all(a,b),new Set()))).toEqual(['a','b'])
})

it('관계가 많은 허브의 이름표는 이웃 점이 빽빽이 둘러싸도 보인다(작은 이웃의 점 때문에 가장 큰 노드의 이름이 사라지지 않는다)',()=>{
 const hub=node('hub',400,300,200,54,'홍길동')
 const around=Array.from({length:12},(_,i)=>node('n'+i,400+Math.cos(i)*45,300+Math.sin(i)*45+60,44,2,'이웃'+i)) // 허브 바로 아래 둘레에 작은 점들
 const nodes=[...around,hub] // 입력 순서와 상관없이 큰 노드가 먼저 자리를 잡는다
 const shown=ids(placeLabels(nodes,{x:0,y:0,k:0.15,w:800,h:600},all(hub),new Set()))
 expect(shown).toEqual(['hub'])
})

it('항상 보이는 이름표(always: 강조한 노드·이웃·고른 카드)는 겹쳐도 보이고 먼저 자리를 잡아 다른 이름표를 막는다',()=>{
 const a=node('a',200,200,44,1),b=node('b',210,200,44,9)
 expect(ids(placeLabels([a,b],view,all(a,b),new Set(['a'])))).toEqual(['a']) // 관계가 많은 b는 a 때문에 숨는다
 const c=node('c',200,100,44,9),d=node('d',200,135,44,1)
 expect(ids(placeLabels([c,d],view,all(c,d),new Set(['c']))).sort()).toEqual(['c','d']) // 점을 가려도 always는 보인다
 expect(ids(placeLabels([a,b],view,new Set(),new Set(['a'])))).toEqual(['a']) // candidates에 없어도 always면 보인다
})

it('화면 밖 노드는 이름표를 만들지 않고 결과는 입력이 같으면 같다',()=>{
 const inside=node('in',100,100),outside=node('out',5000,5000)
 const nodes=[outside,inside]
 expect(ids(placeLabels(nodes,view,all(...nodes),new Set(['out'])))).toEqual(['in'])
 expect(placeLabels(nodes,view,all(...nodes),new Set())).toEqual(placeLabels(nodes,view,all(...nodes),new Set()))
})

/** 처음 맞춘 화면(1140×700 캔버스, 여백 위 24·오른쪽 24·아래 88·왼쪽 72, 최대 1배)의 뷰포트. */
function firstView(positions:ReadonlyMap<string,{x:number;y:number}>,w=1140,h=700){
 const ps=[...positions.values()],x0=Math.min(...ps.map(p=>p.x)),y0=Math.min(...ps.map(p=>p.y)),bw=Math.max(...ps.map(p=>p.x))+CARD_W-x0,bh=Math.max(...ps.map(p=>p.y))+CARD_H-y0
 const pad={t:24,r:24,b:88,l:72},k=Math.min(1,Math.max(0.05,Math.min((w-pad.l-pad.r)/bw,(h-pad.t-pad.b)/bh)))
 return {k,x:pad.l+((w-pad.l-pad.r)-bw*k)/2-x0*k,y:pad.t+((h-pad.t-pad.b)-bh*k)/2-y0*k,w,h}
}

it('홍길동전(57장·146관계)을 처음 맞춘 멀리 화면에서 관계 상위 카드의 이름이 보이고 가장 큰 홍길동이 맨 앞에 있으며, 겹치면 작은 노드부터 숨는다',()=>{
 const nodes=HONGGILDONG_CARDS.map(([id])=>({id})),links=HONGGILDONG_LINKS.map(([source,target])=>({source,target}))
 const positions=forceLayout(nodes,links),order=nodes.map(n=>n.id),degree=degrees(order,links),maxDegree=Math.max(...degree.values())
 const names=new Map(HONGGILDONG_CARDS.map(([id,title])=>[id,title]))
 const labelNodes=order.map(id=>{const p=positions.get(id)!;return {id,cx:p.x+CARD_W/2,cy:p.y+CARD_H/2,d:dotDiameter(degree.get(id)??0,maxDegree),name:names.get(id)!,degree:degree.get(id)??0}})
 const view=firstView(positions)
 expect(view.k).toBeLessThan(0.5) // 멀리(far)
 const candidates=topDegreeIds(order,degree,labelLimit(order.length))
 expect(candidates.size).toBe(12)
 const shown=placeLabels(labelNodes,view,candidates,new Set()).map(l=>l.id)
 expect(shown[0]).toBe('gildong') // 가장 큰 노드가 먼저
 expect(shown.length).toBeGreaterThanOrEqual(8) // 상위 12장 중 겹쳐 숨는 몇 장을 빼고 8장 이상
 expect(shown.every(id=>candidates.has(id))).toBe(true)
 // 숨은 이름표는 모두 먼저 놓인 더 큰(같거나) 노드의 이름표와 겹친 것이다: 작은 노드부터 숨는다
 const hidden=[...candidates].filter(id=>!shown.includes(id)),rank=(id:string)=>order.indexOf(id)
 for(const id of hidden)expect(shown.some(s=>(degree.get(s)??0)>(degree.get(id)??0)||((degree.get(s)??0)===(degree.get(id)??0)&&rank(s)<rank(id))),id).toBe(true)
})
