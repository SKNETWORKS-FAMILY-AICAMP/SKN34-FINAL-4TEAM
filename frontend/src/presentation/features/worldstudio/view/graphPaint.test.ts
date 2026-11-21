import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../viewmodel/graphForces'
import { NODE_R_MAX, NODE_R_MIN, nodeRadius, type GLink, type GNode } from '../viewmodel/graphModel'
import { DIM, SEARCH_DIM, arrowLength, arrowPos, hitAt, hitRadius, labelHit, labelPlan, linkColor, linkWidth, nodeAlpha, paintLabels, paintLinkLabels, paintNode, type PaintState } from './graphPaint'

/** 그리기 호출과 속성 대입을 순서대로 적어 두는 가짜 캔버스. */
function fakeCtx(){
 const log:unknown[][]=[]
 const ctx=new Proxy({},{get:(_,prop)=>prop==='log'?log:(...args:unknown[])=>{log.push([String(prop),...args])},set:(_,prop,value)=>{log.push(['set',String(prop),value]);return true}}) as unknown as CanvasRenderingContext2D&{log:unknown[][]}
 return ctx
}
const sets=(ctx:{log:unknown[][]},prop:string)=>ctx.log.filter(c=>c[0]==='set'&&c[1]===prop).map(c=>c[2])
const calls=(ctx:{log:unknown[][]},name:string)=>ctx.log.filter(c=>c[0]===name)

afterEach(()=>vi.unstubAllGlobals())
const node=(id:string,x:number,y:number,over:Partial<GNode>={}):GNode=>({id,name:id,unnamed:false,degree:1,color:'#67caff',x,y,...over})
const link=(id:string,a:GNode,b:GNode,over:Partial<GLink>={}):GLink=>({id,source:a,target:b,relations:[{id:'r-'+id,source:'a',target:'b',label:'친구',full:'친구',symmetric:true}],directed:false,...over})
const state=(over:Partial<PaintState>={}):PaintState=>({settings:DEFAULT_SETTINGS,around:null,visible:new Set(['a','b','c','d']),selected:'',connecting:null,hotLink:'',pickedLinks:new Set(),top:new Set(),folded:new Map(),maxDegree:10,...over})
const view=(k=1)=>({x:0,y:0,k,w:800,h:600})

it('nodeAlpha: 강조 중이면 중심·이웃만 1이고 나머지는 흐리며, 검색에 맞지 않는 노드도 흐리다(둘이 겹치면 더 흐린 쪽)',()=>{
 expect(nodeAlpha('a',state())).toBe(1)
 const around={id:'a',nodes:new Set(['a','b']),edges:new Set(['a|b'])}
 expect(nodeAlpha('a',state({around}))).toBe(1)
 expect(nodeAlpha('b',state({around}))).toBe(1)
 expect(nodeAlpha('c',state({around}))).toBe(DIM)
 expect(nodeAlpha('c',state({visible:new Set(['a'])}))).toBe(SEARCH_DIM)
 expect(nodeAlpha('c',state({around,visible:new Set(['a'])}))).toBe(Math.min(DIM,SEARCH_DIM))
 expect(DIM).toBeGreaterThanOrEqual(0.15);expect(DIM).toBeLessThanOrEqual(0.2) // 옵시디언 수준: 0.15~0.2
})

it('paintNode는 지름이 크기 배수를 따르는 채운 원을 그리고 강조 밖은 흐리게(globalAlpha) 그린 뒤 알파를 되돌린다',()=>{
 const ctx=fakeCtx(),n=node('c',10,20,{degree:4})
 paintNode(n,ctx,2,state({maxDegree:4,settings:{...DEFAULT_SETTINGS,nodeSize:1.5},around:{id:'a',nodes:new Set(['a']),edges:new Set<string>()}}))
 expect(calls(ctx,'arc')[0]).toEqual(['arc',10,20,NODE_R_MAX*1.5,0,2*Math.PI]) // 관계가 가장 많은 노드의 반지름 × 1.5
 expect(sets(ctx,'fillStyle')[0]).toBe('#67caff')
 expect(sets(ctx,'globalAlpha')[0]).toBe(DIM)
 expect(sets(ctx,'globalAlpha').at(-1)).toBe(1)
 expect(calls(ctx,'fill').length).toBeGreaterThan(0)
})

it('paintNode는 고른 노드·강조 중심에 고리를, 연결 모드의 주체에 실선·상대 후보에 점선 고리를 그린다',()=>{
 const ring=(s:Partial<PaintState>,id='a')=>{const ctx=fakeCtx();paintNode(node(id,0,0),ctx,1,state(s));return {strokes:calls(ctx,'stroke').length,dash:calls(ctx,'setLineDash')}}
 expect(ring({}).strokes).toBe(0) // 평소에는 고리가 없다(옵시디언처럼 채운 원 하나)
 expect(ring({selected:'a'}).strokes).toBeGreaterThan(0)
 expect(ring({around:{id:'a',nodes:new Set(['a']),edges:new Set<string>()}}).strokes).toBeGreaterThan(0)
 expect(ring({connecting:'a'}).strokes).toBeGreaterThan(0) // 주체
 const other=ring({connecting:'a'},'b')
 expect(other.strokes).toBeGreaterThan(0) // 상대 후보: 점선
 expect(other.dash.some(c=>Array.isArray(c[1])&&c[1].length>0)).toBe(true)
})

it('paintNode: 어느 배율에서도 화면 반지름 3px 아래로 줄지 않고(멀리서 점이 사라지지 않는다) 크기 배수를 곱한다',()=>{
 const radius=(k:number,s=state())=>{const ctx=fakeCtx();paintNode(node('c',0,0,{degree:0}),ctx,k,s);return calls(ctx,'arc')[0][3] as number}
 expect(radius(1)).toBe(NODE_R_MIN)
 expect(radius(0.1)).toBeCloseTo(30,6) // 화면 3px ÷ 0.1
 expect(radius(0.5,state({settings:{...DEFAULT_SETTINGS,nodeSize:0.4}}))).toBeCloseTo(6,6) // 4×0.4=1.6이라 화면 3px(÷0.5)로 올린다
})

it('paintNode: 접힌 위성이 있는 허브는 접힌 수만큼 커지고(지름이 √(관계 수+접힌 수)에 비례, 최대를 넘지 않는다) 안쪽에 얇은 고리가 있다',()=>{
 const drawn=(n:GNode,s:PaintState)=>{const ctx=fakeCtx();paintNode(n,ctx,1,s);return {arcs:calls(ctx,'arc'),strokes:calls(ctx,'stroke').length}}
 const s=state({maxDegree:30,folded:new Map([['hub',20]])})
 const hub=drawn(node('hub',0,0,{degree:10}),s),plain=drawn(node('plain',0,0,{degree:10}),s)
 expect(hub.arcs[0][3]).toBeGreaterThan(plain.arcs[0][3] as number) // 같은 관계 수여도 접힌 수만큼 크다
 expect(hub.arcs[0][3]).toBeCloseTo(NODE_R_MAX,6) // 관계 10 + 접힌 20 = 최대(30)
 expect(hub.arcs).toHaveLength(2) // 채운 원 + 안쪽 고리
 expect(hub.arcs[1][3]).toBeLessThan(hub.arcs[0][3] as number)
 expect(hub.strokes).toBe(1)
 expect(plain.arcs).toHaveLength(1);expect(plain.strokes).toBe(0) // 위성이 없는 노드는 고리가 없다
 expect(drawn(node('hub',0,0,{degree:10}),state({maxDegree:30,folded:new Map([['hub',500]])})).arcs[0][3]).toBe(NODE_R_MAX) // 최대를 넘지 않는다
})

it('hitRadius는 점보다 조금 넓고 멀리서도(배율이 작아도) 화면 8px 반지름 아래로 줄지 않아 누를 수 있다',()=>{
 expect(hitRadius(node('a',0,0,{degree:10}),1,state({maxDegree:10}))).toBeGreaterThan(NODE_R_MAX)
 expect(hitRadius(node('a',0,0,{degree:0}),0.1,state())).toBeGreaterThanOrEqual(80) // 8px / 0.1
 expect(hitRadius(node('a',0,0,{degree:0}),1,state({settings:{...DEFAULT_SETTINGS,nodeSize:2}}))).toBeGreaterThanOrEqual(8)
})

it('labelHit: 접힌 허브만 이름표 영역(점 아래부터 글자 높이까지, 이름표 폭)을 눌러 펼칠 수 있고, 다른 노드와 펼친 허브는 null이다',()=>{
 const hub=node('a',0,0,{degree:9,name:'해그리드'}),s=state({maxDegree:9,folded:new Map([['a',3]])})
 const box=labelHit(hub,1,s)!
 expect(box.halfW).toBeGreaterThan(20)
 expect(box.top).toBeGreaterThanOrEqual(NODE_R_MIN) // 점 아래쪽 끝에서 시작해서
 expect(box.bottom).toBeGreaterThan(box.top + 20) // 글자 높이까지 이어진다
 expect(labelHit(node('b',0,0),1,s)).toBeNull()
 expect(labelHit(hub,1,state({maxDegree:9}))).toBeNull()
})

it('labelPlan: 접힌 위성이 있는 허브의 이름표는 이름 +N이고 펼친 허브는 이름만이다',()=>{
 const hub=node('a',100,100,{degree:9,name:'해그리드'}),other=node('b',400,100,{degree:2,name:'다른 노드'})
 const texts=(folded:Map<string,number>)=>labelPlan([hub,other],view(1),state({top:new Set(['a','b']),folded})).map(l=>l.text)
 expect(texts(new Map([['a',12]]))).toEqual(['해그리드 +12','다른 노드'])
 expect(texts(new Map())).toEqual(['해그리드','다른 노드'])
})

it('labelPlan: 임계값 위에서는 모든 이름이, 아래에서는 관계 상위(top) 노드의 이름만 남고 서서히 사라진다',()=>{
 const nodes=[node('a',100,100,{degree:9}),node('b',400,100,{degree:2}),node('c',100,400,{degree:2})]
 const s=state({top:new Set(['a'])})
 const names=(k:number)=>labelPlan(nodes,view(k),s).map(l=>l.id)
 expect(names(1)).toEqual(['a','b','c']) // 임계값 0.7 위
 expect(names(0.3)).toEqual(['a']) // 임계값의 60%(0.42) 아래: top만
 const mid=labelPlan(nodes,view(0.56),s) // 0.42~0.7 사이: 서서히
 expect(mid.map(l=>l.id)).toEqual(['a','b','c'])
 expect(mid.find(l=>l.id==='a')!.alpha).toBe(1)
 expect(mid.find(l=>l.id==='b')!.alpha).toBeGreaterThan(0);expect(mid.find(l=>l.id==='b')!.alpha).toBeLessThan(1)
})

it('labelPlan: 강조 중이면 중심의 이름은 늘 보이고(가려져 있어도), 이웃의 이름은 겹치지 않는 범위에서 우선으로 보이며, 나머지는 흐리다(겹침 숨김은 강조 중에도 적용)',()=>{
 const hub=node('hub',200,200,{degree:3,name:'가려진 노드'}),big=node('big',210,200,{degree:50,name:'큰 노드'}),near=node('near',300,200,{degree:1,name:'이웃'}),far=node('far',500,400,{degree:2,name:'먼 노드'})
 const around={id:'hub',nodes:new Set(['hub','near']),edges:new Set<string>()}
 const plan=labelPlan([big,hub,near,far],view(1),state({around,top:new Set(['big','far']),visible:new Set(['hub','big','near','far'])}))
 const ids=plan.map(l=>l.id)
 expect(ids).toContain('hub') // 중심은 항상(관계가 더 많은 큰 노드가 겹쳐 있어도)
 expect(ids).toContain('near')
 expect(ids.indexOf('hub')).toBeLessThan(ids.indexOf('near')) // 중심이 먼저
 expect(ids).not.toContain('big') // 강조 중 큰 노드의 이름도 겹치면 숨는다(중심이 먼저 자리를 잡았다)
 expect(plan.find(l=>l.id==='hub')!.alpha).toBe(1)
 expect(plan.find(l=>l.id==='near')!.alpha).toBe(1)
 expect(plan.find(l=>l.id==='far')!.alpha).toBeLessThanOrEqual(DIM) // 이웃이 아닌 노드의 이름은 흐리다
})

it('labelPlan: 강조 중심과 고른 노드의 이름은 서로 겹쳐도 둘 다 보인다(항상 보이는 이름끼리는 서로 막지 않는다)',()=>{
 const hub=node('hub',200,200,{degree:3,name:'중심'}),picked=node('picked',205,200,{degree:9,name:'고른 노드'})
 const around={id:'hub',nodes:new Set(['hub']),edges:new Set<string>()}
 const ids=labelPlan([picked,hub],view(1),state({around,selected:'picked',visible:new Set(['hub','picked'])})).map(l=>l.id)
 expect(ids.sort()).toEqual(['hub','picked'])
})

it('labelPlan: 이웃의 이름은 텍스트 임계값 아래로 멀리 가도 보이고, 고른 노드·연결 주체의 이름도 늘 보인다',()=>{
 const nodes=[node('a',100,100),node('b',300,100),node('c',500,100),node('d',100,300)]
 const around={id:'a',nodes:new Set(['a','b']),edges:new Set<string>()}
 const ids=labelPlan(nodes,view(0.1),state({around,selected:'c',connecting:'d',visible:new Set(['a','b','c','d'])})).map(l=>l.id)
 expect(ids.sort()).toEqual(['a','b','c','d'])
})

it('paintLabels는 이름을 노드 아래 화면 크기의 글자로 그리고(font = 크기/배율) 테두리를 먼저 그린 뒤 채우며 투명도를 적용하고 되돌린다',()=>{
 const ctx=fakeCtx(),n=node('a',100,50,{name:'홍길동',degree:9}),k=0.5
 const plan=labelPlan([n],{x:20,y:30,k,w:800,h:600},state({top:new Set(['a']),maxDegree:9}))
 paintLabels(ctx,plan,{x:20,y:30,k,w:800,h:600})
 expect(String(sets(ctx,'font')[0])).toMatch(/^700 28px /) // 14px(관계 최대) ÷ 0.5
 const stroke=calls(ctx,'strokeText')[0],fill=calls(ctx,'fillText')[0]
 expect(stroke.slice(0,2)).toEqual(['strokeText','홍길동'])
 expect(fill.slice(0,2)).toEqual(['fillText','홍길동'])
 expect(fill[2]).toBeCloseTo(100,6) // 노드 가운데
 expect(fill[3]).toBeCloseTo(50+NODE_R_MAX+4/k,6) // 노드 아래 반지름 + 화면 4px
 expect(ctx.log.findIndex(c=>c[0]==='strokeText')).toBeLessThan(ctx.log.findIndex(c=>c[0]==='fillText'))
 expect(sets(ctx,'globalAlpha').at(-1)).toBe(1)
})

it('linkColor: 평소는 가는 회색 한 가지이고, 강조 중이면 닿는 선만 강조색이고 나머지는 거의 안 보이며, 올린·고른 선은 강조색이다',()=>{
 const a=node('a',0,0),b=node('b',50,0),c=node('c',0,50),ab=link('a|b',a,b),bc=link('b|c',b,c)
 const base=linkColor(ab,state())
 const around={id:'a',nodes:new Set(['a','b']),edges:new Set(['a|b'])}
 expect(linkColor(ab,state({around}))).not.toBe(base)
 expect(linkColor(bc,state({around}))).not.toBe(base)
 expect(linkColor(ab,state({hotLink:'a|b'}))).toBe(linkColor(ab,state({around}))) // 올린 선도 강조색
 expect(linkColor(bc,state({pickedLinks:new Set(['b|c'])}))).toBe(linkColor(ab,state({around})))
 expect(linkColor(ab,state({visible:new Set(['a'])}))).not.toBe(base) // 검색에 안 맞는 노드로 가는 선은 흐리다
})

it('linkWidth: 모든 선은 화면 기준 가는 선(1px, 고해상도에서는 1/배율)이고, 합친 평행 관계가 많아도 굵어지지 않으며, 강조·올린·고른 선은 색만 바뀌고 굵기는 1.5배(최대 1.5px)다',()=>{
 const a=node('a',0,0),b=node('b',50,0),c=node('c',0,50)
 const rel=(i:number)=>({id:'r'+i,source:'a',target:'b',label:'친구',full:'친구',symmetric:true})
 const ab=link('a|b',a,b),bc=link('b|c',b,c),many=link('a|c',a,c,{relations:[rel(1),rel(2),rel(3),rel(4),rel(5)]})
 expect(linkWidth(ab,state())).toBe(1)
 expect(linkWidth(many,state())).toBe(1) // 평행 관계 다섯 개를 합친 선도 한 가닥과 같다
 const around={id:'a',nodes:new Set(['a','b']),edges:new Set(['a|b'])}
 expect(linkWidth(ab,state({around}))).toBe(1.5)
 expect(linkWidth(ab,state({hotLink:'a|b'}))).toBe(1.5)
 expect(linkWidth(bc,state({pickedLinks:new Set(['b|c'])}))).toBe(1.5)
 expect(linkWidth(bc,state({around}))).toBe(1) // 닿지 않는 선은 흐리기만 하다
 expect(linkWidth(ab,state({settings:{...DEFAULT_SETTINGS,linkWidth:2}}))).toBe(2) // 선 두께 배수(기본 1이 최소)
 vi.stubGlobal('devicePixelRatio',2)
 expect(linkWidth(ab,state())).toBe(0.5) // 고해상도: 장치 픽셀 한 줄
 expect(linkWidth(ab,state({around}))).toBe(0.75)
})

it('linkColor: 노드 강조를 고정한 채 닿지 않는 선을 올리거나(올린 선) 편집 중인 선(고른 선)이어도 그 선은 강조색이다(두께만 굵어지고 색이 흐린 채 남지 않는다)',()=>{
 const a=node('a',0,0),b=node('b',50,0),c=node('c',0,50),ab=link('a|b',a,b),bc=link('b|c',b,c)
 const around={id:'a',nodes:new Set(['a','b']),edges:new Set(['a|b'])}
 const active=linkColor(ab,state({around}))
 expect(linkColor(bc,state({around}))).not.toBe(active) // 닿지 않는 선은 흐리다
 expect(linkColor(bc,state({around,hotLink:'b|c'}))).toBe(active) // 올린 선은 강조 중에도 강조색
 expect(linkColor(bc,state({around,pickedLinks:new Set(['b|c'])}))).toBe(active) // 편집 중인 선도
})

it('arrowLength는 화살표를 켜고 방향 있는 선에만 0보다 크다(기본 꺼짐)',()=>{
 const a=node('a',0,0),b=node('b',50,0),dir=link('a|b',a,b,{directed:true}),sym=link('a|c',a,b)
 expect(arrowLength(dir,state())).toBe(0)
 expect(arrowLength(dir,state({settings:{...DEFAULT_SETTINGS,arrows:true}}))).toBeGreaterThan(0)
 expect(arrowLength(sym,state({settings:{...DEFAULT_SETTINGS,arrows:true}}))).toBe(0)
})

it('paintLinkLabels는 올린·고른 선에만 관계 이름을 선 가운데에 화면 12px 글자로 그리고, 끝점 좌표가 아직 없으면 건너뛴다',()=>{
 const a=node('a',0,0),b=node('b',100,40),hot=link('a|b',a,b,{relations:[{id:'r1',source:'a',target:'b',label:'친구',full:'친구',symmetric:true},{id:'r2',source:'a',target:'b',label:'동료',full:'동료',symmetric:true}]}),other=link('a|c',a,node('c',0,100))
 const ctx=fakeCtx()
 paintLinkLabels(ctx,[hot,other],2,state({hotLink:'a|b'}))
 expect(calls(ctx,'fillText')).toHaveLength(1)
 expect(calls(ctx,'fillText')[0].slice(0,4)).toEqual(['fillText','친구 외 1개',50,20])
 expect(String(sets(ctx,'font')[0])).toMatch(/^700 6px /) // 12px ÷ 배율 2
 const none=fakeCtx()
 paintLinkLabels(none,[link('x|y','x' as unknown as GNode,'y' as unknown as GNode)],1,state({hotLink:'x|y'}))
 expect(calls(none,'fillText')).toHaveLength(0)
 const picked=fakeCtx()
 paintLinkLabels(picked,[other],1,state({pickedLinks:new Set(['a|c'])}))
 expect(calls(picked,'fillText')).toHaveLength(1)
})

it('hitAt은 눌린 자리(그래프 좌표)의 가장 가까운 노드를, 없으면 화면 6px 안의 선을, 없으면 null을 돌려준다(노드가 선보다 먼저)',()=>{
 const a=node('a',0,0),b=node('b',100,0),c=node('c',100,100),ab=link('a|b',a,b),bc=link('b|c',b,c)
 const hit=(x:number,y:number,k=1)=>hitAt([a,b,c],[ab,bc],x,y,k,state())
 expect(hit(3,3)).toEqual({kind:'node',id:'a'})
 expect(hit(0,hitRadius(a,1,state())+1)).toBeNull() // 노드의 눌리는 반지름 밖
 expect(hit(50,5)).toEqual({kind:'link',id:'a|b'}) // 선에서 5px
 expect(hit(50,7)).toBeNull()
 expect(hit(50,10,0.5)).toEqual({kind:'link',id:'a|b'}) // 배율 0.5: 그래프 거리 10 = 화면 5px
 expect(hit(105,50)).toEqual({kind:'link',id:'b|c'})
 expect(hit(100,8)).toEqual({kind:'node',id:'b'}) // 선 위여도 노드가 먼저
 const near=node('near',14,0) // a와 눌리는 반지름이 겹치면 중심이 더 가까운 쪽
 expect(hitAt([a,near],[],8,0,1,state())).toEqual({kind:'node',id:'near'})
 expect(hitAt([a,near],[],5,0,1,state())).toEqual({kind:'node',id:'a'})
 expect(hitAt([],[],0,0,1,state())).toBeNull()
 const unplaced=link('x|y','x' as unknown as GNode,'y' as unknown as GNode)
 expect(hitAt([a],[unplaced],0,50,1,state())).toBeNull() // 끝점이 없는 선은 건너뛴다
})

it('arrowPos는 화살표를 목적지 노드의 가장자리 바로 앞에 놓고(큰 노드에 가려지지 않게) 너무 가까우면 선의 한가운데보다 앞으로는 못 간다',()=>{
 const a=node('a',0,0),b=node('b',100,0),far=link('a|b',a,b),r=nodeRadius(1,10)
 expect(arrowPos(far,state(),1)).toBeCloseTo(1-(r+3)/100,10)
 expect(arrowPos(far,state({settings:{...DEFAULT_SETTINGS,nodeSize:2}}),1)).toBeCloseTo(1-(2*r+3)/100,10) // 크기 슬라이더만큼 가장자리도 밖으로
 expect(arrowPos(far,state(),0.1)).toBeCloseTo(1-(30+3)/100,10) // 멀리서는 화면 3px 최소 반지름(그래프 단위 30)이 가장자리다
 const near=link('a|c',a,node('c',20,0,{degree:10}))
 expect(arrowPos(near,state(),1)).toBe(0.5) // 가장자리가 중심을 넘어도 절반 아래로 내려가지 않는다
 const unplaced=link('x|y','x' as unknown as GNode,'y' as unknown as GNode)
 expect(arrowPos(unplaced,state(),1)).toBe(0.9) // 끝점 좌표가 아직 없으면 기본 위치
})
