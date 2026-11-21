import { expect, it } from 'vitest'
import { honggildongMap } from '../../../../test/honggildongGraph'
import { NODE_R_MAX, NODE_R_MIN, NODE_SCREEN_MIN, buildGraph, degrees, drawRadius, labelFont, labelLimit, nodeRadius, relationNames, relationTitle, textAlpha, topDegreeIds, type GNode } from './graphModel'
import { neighborhood } from './highlight'
import type { MapLink, MapNode } from './useWorldMapViewModel'

const node=(id:string,over:Partial<MapNode>={}):MapNode=>({id,name:id,kind:'인물',type:'character',text:'',tags:[],...over})
const link=(source:string,target:string,over:Partial<MapLink>={}):MapLink=>({id:source+'>'+target,source,target,label:'친구',...over})

it('nodeRadius는 관계가 없으면 최소·가장 많으면 최대이고 그 사이는 √(관계 수)에 비례해 늘며 크기 배수를 곱한다',()=>{
 expect(nodeRadius(0,10)).toBe(NODE_R_MIN)
 expect(nodeRadius(10,10)).toBe(NODE_R_MAX)
 expect(nodeRadius(99,10)).toBe(NODE_R_MAX) // 최대를 넘지 않는다
 expect(nodeRadius(0,0)).toBe(NODE_R_MIN) // 관계가 하나도 없는 그래프
 const quarter=nodeRadius(25,100),mid=NODE_R_MIN+(NODE_R_MAX-NODE_R_MIN)*0.5
 expect(quarter).toBeCloseTo(mid,10) // √(25/100)=0.5: 관계 수가 4배 늘어야 늘어난 폭이 2배
 expect(nodeRadius(4,100)).toBeLessThan(nodeRadius(9,100)) // 단조 증가
 expect(nodeRadius(10,10,2)).toBe(NODE_R_MAX*2) // 크기 슬라이더
 expect(nodeRadius(0,10,0.5)).toBe(NODE_R_MIN*0.5)
})

it('degrees는 관계 한 줄이 양쪽 끝에 한 번씩 더해지고 그래프에 없는 끝점은 세지 않는다',()=>{
 const d=degrees(['a','b','c'],[{source:'a',target:'b'},{source:'a',target:'b'},{source:'b',target:'없음'}])
 expect([...d]).toEqual([['a',2],['b',3],['c',0]])
})

it('labelLimit은 멀리서 이름을 붙이는 카드 수라 관계 상위 8~12개이고(카드가 적어도 8개, 많아도 12개, 그 사이는 약 20%) topDegreeIds는 관계가 있는 카드 중 많은 쪽부터(같으면 앞선 카드) 뽑는다',()=>{
 expect([0,5,40,41,50,57,100,1000].map(labelLimit)).toEqual([8,8,8,9,10,12,12,12])
 const order=['a','b','c','d','e','f'],degree=new Map([['a',2],['b',5],['c',5],['d',0],['e',3],['f',0]])
 expect([...topDegreeIds(order,degree,3)]).toEqual(['b','c','e'])
 expect([...topDegreeIds(order,degree,10)]).toEqual(['b','c','e','a']) // 관계 없는 d·f는 limit이 남아도 뽑지 않는다
 expect(topDegreeIds(order,new Map(order.map(id=>[id,0])),3).size).toBe(0)
})

it('labelFont는 늘 12px 이상이고 관계가 가장 많은 쪽은 14px, 4분의 1 이상은 13px다',()=>{
 expect([0,5,24,25,26,49,50,100].map(d=>labelFont(d,100))).toEqual([12,12,12,13,13,13,14,14])
 expect(labelFont(0,0)).toBe(12)
 for(let d=0;d<=100;d++)expect(labelFont(d,100)).toBeGreaterThanOrEqual(12)
})

it('textAlpha는 확대 배율이 텍스트 표시 임계값 이상이면 1, 임계값의 60% 이하면 0, 그 사이는 서서히 나타난다(임계값 0이면 늘 보인다)',()=>{
 expect(textAlpha(1,1)).toBe(1)
 expect(textAlpha(2,1)).toBe(1)
 expect(textAlpha(0.6,1)).toBe(0)
 expect(textAlpha(0.2,1)).toBe(0)
 expect(textAlpha(0.8,1)).toBeCloseTo(0.5,10)
 expect(textAlpha(0.7,1)).toBeLessThan(textAlpha(0.9,1)) // 단조 증가
 expect(textAlpha(0.01,0)).toBe(1)
})

it('buildGraph는 같은 쌍의 관계를 선 하나로 묶고(관계는 모두 남긴다) 없는 카드·자기 자신으로 가는 관계는 버리며 크기는 묶기 전 관계 수로 정한다',()=>{
 const g=buildGraph([node('a'),node('b'),node('c')],[link('a','b',{label:'친구'}),link('b','a',{id:'r2',label:'동료'}),link('a','c'),link('a','a'),link('a','없음')])
 expect(g.nodes.map(n=>n.id)).toEqual(['a','b','c'])
 expect(g.links).toHaveLength(2)
 const ab=g.links.find(l=>l.id==='a|b')!
 expect(ab.relations.map(r=>r.label)).toEqual(['친구','동료']) // 방향이 달라도 한 쌍
 expect(g.nodes.map(n=>n.degree)).toEqual([3,2,1])
 expect(g.maxDegree).toBe(3)
})

it('buildGraph는 방향 있는 관계가 하나라도 있으면 선을 방향 있다고 하고 그 방향을 따르며, 대칭 관계만이면 방향이 없다',()=>{
 const symmetric=buildGraph([node('a'),node('b')],[link('a','b',{symmetric:true})]).links[0]
 expect(symmetric.directed).toBe(false)
 const mixed=buildGraph([node('a'),node('b')],[link('a','b',{symmetric:true}),link('b','a',{symmetric:false,label:'따른다'})]).links[0]
 expect(mixed.directed).toBe(true)
 expect([mixed.source,mixed.target]).toEqual(['b','a'])
})

it('buildGraph는 이미 있는 카드를 같은 객체로 돌려주며 좌표를 잇고, 새 카드는 spawn 좌표에서 시작하며, 이름·유형·색·크기는 새 값으로 고친다',()=>{
 const first=buildGraph([node('a'),node('b')],[link('a','b')])
 Object.assign(first.nodes[0],{x:10,y:20,vx:1,vy:2})
 const previous=new Map(first.nodes.map(n=>[n.id,n]))
 const next=buildGraph([node('a',{name:'새 이름',type:'location'}),node('b'),node('c')],[link('a','b'),link('a','c')],previous,new Map([['c',{x:5,y:6}]]))
 expect(next.nodes[0]).toBe(first.nodes[0])
 expect([next.nodes[0].x,next.nodes[0].y,next.nodes[0].vx]).toEqual([10,20,1])
 expect(next.nodes[0].name).toBe('새 이름')
 expect(next.nodes[0].type).toBe('location')
 expect(next.nodes[0].degree).toBe(2)
 expect([next.nodes[2].x,next.nodes[2].y]).toEqual([5,6])
 expect(next.nodes[1].x).toBeUndefined() // spawn이 없는 새 카드는 react-force-graph가 자리를 정한다
})

it('이름이 없는 카드(unnamed)와 유형이 없는 카드도 그려진다(기타 색)',()=>{
 const g=buildGraph([node('a',{unnamed:true}),node('b',{type:undefined})],[])
 expect(g.nodes[0].unnamed).toBe(true)
 expect(g.nodes[1].color).toBe('#a5b8d8')
})

it('relationTitle은 관계 자신의 방향을 이름에 담는다(방향 있는 관계는 →, 대칭은 ↔)',()=>{
 const name=(id:string)=>({a:'가람',b:'나래'})[id as 'a'|'b']
 expect(relationTitle({source:'a',target:'b',full:'신뢰',symmetric:false},name)).toBe('가람 → 나래 · 신뢰')
 expect(relationTitle({source:'b',target:'a',full:'친구',symmetric:true},name)).toBe('나래 ↔ 가람 · 친구')
})

it('buildGraph는 묶은 관계마다 자기 방향(source·target)을 남긴다(선의 방향과 다를 수 있다)',()=>{
 const g=buildGraph([node('a'),node('b')],[link('a','b',{symmetric:true,label:'친구'}),link('b','a',{symmetric:false,label:'신뢰'})])
 expect(g.links[0].relations.map(x=>[x.source,x.target,x.label])).toEqual([['a','b','친구'],['b','a','신뢰']])
})

it('relationNames는 선에 올렸을 때 보이는 이름이다: 관계가 하나면 그 이름, 여럿이면 첫 관계 외 N개(개수는 이 말로만 알린다)',()=>{
 const r=(label:string)=>({source:'a',target:'b',label,full:label,symmetric:false})
 expect(relationNames({relations:[r('부자 관계')]})).toBe('부자 관계')
 expect(relationNames({relations:[r('부자 관계'),r('아버지'),r('효도'),r('신임'),r('경고')]})).toBe('부자 관계 외 4개')
 expect(relationNames({relations:[r('친구'),r('친구')]})).toBe('친구 외 1개')
})

it('drawRadius는 어느 배율에서도 화면 반지름 3px 아래로 줄지 않는다(멀리서 점이 사라지지 않는다)',()=>{
 expect(NODE_SCREEN_MIN).toBe(3)
 expect(drawRadius(4,1)).toBe(4)
 expect(drawRadius(4,0.2)).toBeCloseTo(15,10) // 3px ÷ 0.2
 expect(drawRadius(NODE_R_MAX,0.2)).toBe(NODE_R_MAX) // 이미 충분히 크면 그대로
 expect(NODE_R_MAX).toBeGreaterThanOrEqual(24) // 허브가 확실히 크다
})

it('홍길동전(카드 57장·관계 146개): 홍길동은 관계 54개·서로 다른 이웃 38장이고 이웃 강조는 선 쌍 단위로 같은 이웃을 준다',()=>{
 const map=honggildongMap(),g=buildGraph(map.nodes,map.links)
 expect(g.nodes).toHaveLength(57)
 expect(g.links.reduce((sum,l)=>sum+l.relations.length,0)).toBe(146)
 expect(g.links.length).toBeLessThan(146) // 같은 쌍의 관계가 묶였다
 const gil=g.nodes.find(n=>n.id==='gildong') as GNode
 expect(gil.degree).toBe(54)
 expect(g.maxDegree).toBe(54)
 const around=neighborhood('gildong',g.links.map(l=>({id:l.id,source:l.source as string,target:l.target as string})))
 expect(around.nodes.size).toBe(39) // 자신 + 이웃 38장
 expect(around.edges.size).toBe(g.links.filter(l=>l.source==='gildong'||l.target==='gildong').length)
 expect(g.nodes.filter(n=>n.degree===0).map(n=>n.id).sort()).toEqual(['narrator','rule-filial','rule-seoeol']) // 이어지지 않은 카드 3장
})