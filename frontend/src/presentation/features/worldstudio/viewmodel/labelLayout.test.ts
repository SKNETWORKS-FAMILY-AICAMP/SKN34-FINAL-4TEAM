import { expect, it } from 'vitest'
import { placeLabels, type LabelNode } from './labelLayout'

const node=(id:string,cx:number,cy:number,d=44,degree=1,name=id,size=12):LabelNode=>({id,cx,cy,d,degree,name,size})
const view={x:0,y:0,k:1,w:800,h:600}
const ids=(list:{id:string}[])=>list.map(l=>l.id)
const all=(...nodes:LabelNode[])=>new Set(nodes.map(n=>n.id))

it('이름표는 노드 바로 아래 화면 4px에 놓이고 글자는 확대 배율과 상관없이 호출한 크기 그대로다(점은 배율을 따라 줄지만 이름표는 줄지 않는다)',()=>{
 const a=node('a',200,200,44)
 expect(placeLabels([a],view,all(a),new Set())).toEqual([{id:'a',x:200,y:200+22+4,size:12}])
 const far=placeLabels([a],{...view,x:100,y:50,k:0.1},all(a),new Set())[0] // 멀리: 점은 4.4px이지만 이름표는 그대로 12px, 점 바로 아래 4px
 expect(far.size).toBe(12)
 expect(far.x).toBeCloseTo(200*0.1+100,5)
 expect(far.y).toBeCloseTo(200*0.1+50+22*0.1+4,5)
 expect(placeLabels([node('big',200,200,36,50,'큰 노드',14)],view,all(node('big',0,0)),new Set())[0].size).toBe(14) // 관계가 많은 노드는 더 큰 글자
 for(const k of [0.05,0.2,0.5,0.9,1.75])expect(placeLabels([a],{x:0,y:0,k,w:4000,h:4000},all(a),new Set())[0]?.size,'k='+k).toBe(12)
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
 const hub=node('hub',400,300,36,54,'홍길동',14)
 const around=Array.from({length:12},(_,i)=>node('n'+i,400+Math.cos(i)*45,300+Math.sin(i)*45+60,8,2,'이웃'+i)) // 허브 바로 아래 둘레에 작은 점들
 const nodes=[...around,hub] // 입력 순서와 상관없이 큰 노드가 먼저 자리를 잡는다
 const shown=ids(placeLabels(nodes,{x:0,y:0,k:0.15,w:800,h:600},all(hub),new Set()))
 expect(shown).toEqual(['hub'])
})

it('우선순위 값이 큰 이름표(강조한 이웃)가 먼저 자리를 잡아 겹치는 더 작은 이름표를 숨긴다',()=>{
 const small=node('small',200,200,10,2,'작은 노드'),neighbor=node('neighbor',210,200,10,1+1e6,'이웃') // 관계는 적어도 강조한 이웃이라 우선
 expect(ids(placeLabels([small,neighbor],view,all(small,neighbor),new Set()))).toEqual(['neighbor'])
})

it('항상 보이는 이름표(always: 강조 중심·고른 카드)는 겹쳐도 보이고 먼저 자리를 잡아 다른 이름표를 막는다',()=>{
 const a=node('a',200,200,44,1),b=node('b',210,200,44,9)
 expect(ids(placeLabels([a,b],view,all(a,b),new Set(['a'])))).toEqual(['a']) // 관계가 많은 b는 a 때문에 숨는다
 const c=node('c',200,100,44,9),d=node('d',200,135,44,1)
 expect(ids(placeLabels([c,d],view,all(c,d),new Set(['c']))).sort()).toEqual(['c','d']) // 점을 가려도 always는 보인다
 expect(ids(placeLabels([a,b],view,new Set(),new Set(['a'])))).toEqual(['a']) // candidates에 없어도 always면 보인다
 const x=node('x',200,200,44,1),y=node('y',210,200,44,9)
 expect(ids(placeLabels([x,y],view,all(x,y),new Set(['x','y']))).sort()).toEqual(['x','y']) // always끼리는 서로 막지 않는다
})

it('화면 밖 노드는 이름표를 만들지 않고 결과는 입력이 같으면 같다',()=>{
 const inside=node('in',100,100),outside=node('out',5000,5000)
 const nodes=[outside,inside]
 expect(ids(placeLabels(nodes,view,all(...nodes),new Set(['out'])))).toEqual(['in'])
 expect(placeLabels(nodes,view,all(...nodes),new Set())).toEqual(placeLabels(nodes,view,all(...nodes),new Set()))
})
