import { expect, it } from 'vitest'
import { labelSize, labelWidth, placeLabels, type LabelNode } from './labelLayout'

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

it('이름표가 다른 노드의 몸통(점)을 가리면 숨긴다',()=>{
 const a=node('a',200,100,44,9),b=node('b',200,135,44,1) // a의 이름표(위 126)가 b의 점(113~157)을 가린다
 expect(ids(placeLabels([a,b],view,all(a,b),new Set()))).toEqual(['b'])
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
