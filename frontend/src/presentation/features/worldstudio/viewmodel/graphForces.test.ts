import { expect, it } from 'vitest'
import { AUTO_MAX, DEFAULT_SETTINGS, RANGES, dotBox, forceParams, labelBox, labelCollide } from './graphForces'

type N={id:string;name:string;r:number;x:number;y:number;vx:number;vy:number}
const node=(id:string,x:number,y:number,name='이름',r=6):N=>({id,name,r,x,y,vx:0,vy:0})
const run=(nodes:N[],alpha=1,size=1)=>{const force=labelCollide<N>(n=>labelBox(n.name,n.r*size));force.initialize(nodes);force(alpha);return nodes}

it('기본값은 슬라이더 범위 안이고 슬라이더 값은 힘의 세기로 바뀐다(중심력→중력, 반발력→전하, 연결 힘·거리 그대로)',()=>{
 for(const key of Object.keys(RANGES) as (keyof typeof RANGES)[]){
  const [min,max]=RANGES[key],value=DEFAULT_SETTINGS[key]
  expect(value,key).toBeGreaterThanOrEqual(min)
  expect(value,key).toBeLessThanOrEqual(max)
 }
 expect(forceParams({...DEFAULT_SETTINGS,center:0.5,repel:6,linkForce:0.7,linkDistance:60})).toEqual({gravity:0.1,charge:-180,orphanCharge:-30,linkStrength:0.7,linkDistance:60})
 expect(forceParams({...DEFAULT_SETTINGS,center:0,repel:0}).charge).toBeCloseTo(0,10) // -0도 0이다
 expect(forceParams({...DEFAULT_SETTINGS,repel:20}).charge).toBe(-600)
 expect(DEFAULT_SETTINGS.arrows).toBe(false) // 옵시디언처럼 화살표는 기본 꺼짐
 expect(DEFAULT_SETTINGS.orphans).toBeNull() // 자동: 노드가 60개를 넘는 큰 세계관에서만 숨긴다(바깥에 점 고리를 만들지 않게)
 expect(AUTO_MAX).toBe(60)
 expect(DEFAULT_SETTINGS.fold).toBe(true) // 위성 노드 접기는 기본 켬(60개 초과일 때만 적용)
 expect(DEFAULT_SETTINGS.linkWidth).toBe(RANGES.linkWidth[0]) // 선 두께는 가장 얇은 값(최소)이 기본이다
})

it('외톨이는 약하게 밀어내고(orphanCharge) 점 크기만큼만 차지한다(dotBox): 이름표 상자 없이 무리 가장자리에 촘촘히 놓인다',()=>{
 expect(forceParams({...DEFAULT_SETTINGS,repel:20}).orphanCharge).toBe(-100)
 expect(Math.abs(forceParams(DEFAULT_SETTINGS).orphanCharge)).toBeLessThan(Math.abs(forceParams(DEFAULT_SETTINGS).charge)/3)
 expect(dotBox(6)).toEqual({halfW:6,up:6,down:6})
 expect(dotBox(6).down).toBeLessThan(labelBox('가나다라',6).down)
})

it('labelBox는 이름표(화면 12px, 노드 아래 4px)가 차지하는 상자다: 노드 반지름보다 이름이 넓으면 이름 폭, 짧으면 반지름이고, 이름이 아주 길어도 폭을 제한한다',()=>{
 const short=labelBox('가',6),long=labelBox('가'.repeat(40),6),mid=labelBox('길동의 집 하직',6)
 expect(short.halfW).toBe(10) // 글자 12px + 여백 8px의 절반: 점(반지름 6)보다 넓다
 expect(labelBox('가',18).halfW).toBe(18) // 점이 더 크면 점의 반지름이다
 expect(mid.halfW).toBeGreaterThan(short.halfW)
 expect(long.halfW).toBeLessThanOrEqual(70) // 긴 이름이 배치를 터뜨리지 않는다
 expect(short.up).toBe(6)
 expect(short.down).toBeGreaterThan(6+4) // 점 아래 4px + 글자 높이
 expect(labelBox('가',12).up).toBe(12) // 크기 슬라이더로 반지름이 커지면 따라 커진다
})

it('겹치지 않은 두 노드는 건드리지 않는다',()=>{
 const [a,b]=run([node('a',0,0),node('b',200,0)])
 expect([a.vx,a.vy,b.vx,b.vy]).toEqual([0,0,0,0])
})

it('가로로 겹치면 가로로, 세로로 겹치면 세로로 서로 밀어낸다(이름표 폭·높이 포함)',()=>{
 const [a,b]=run([node('a',0,0,'가나다라마바사',6),node('b',70,0,'가나다라마바사',6)]) // 이름표 폭(92)이 점보다 훨씬 넓은 두 노드가 나란히(가로로 겹친 폭 30이 세로로 겹친 높이 35.6보다 작다)
 expect(a.vx).toBeLessThan(0)
 expect(b.vx).toBeGreaterThan(0)
 expect(a.vx).toBe(-b.vx) // 같은 힘으로 반대로
 const [c,d]=run([node('c',0,0,'가',6),node('d',0,14,'가',6)]) // 위아래로 가까움: 위 노드의 이름표가 아래 노드를 덮는다
 expect(c.vy).toBeLessThan(0)
 expect(d.vy).toBeGreaterThan(0)
 expect(c.vx).toBe(0)})

it('이름표가 점 아래에 있어 이름표 높이만큼 위아래로는 더 떨어져야 한다: 같은 거리의 둘이 겹치지 않을 때와 겹칠 때',()=>{
 const far=run([node('a',0,0,'가',6),node('b',0,40,'가',6)]) // 점 12 + 이름표 20 = 32 < 40
 expect(far[0].vy).toBe(0)
 const near=run([node('a',0,0,'가',6),node('b',0,30,'가',6)])
 expect(near[0].vy).toBeLessThan(0)
})

it('같은 자리의 두 노드도 정해진 방향으로 갈라지고(난수 없음) 같은 입력은 같은 결과다',()=>{
 const make=()=>[node('a',5,5),node('b',5,5),node('c',5,5)]
 const x=run(make()),y=run(make())
 expect(x.map(n=>[n.vx,n.vy])).toEqual(y.map(n=>[n.vx,n.vy]))
 expect(x[0].vx===0&&x[0].vy===0).toBe(false)
 expect(x[0].vy).not.toBe(x[1].vy) // 셋이 한 줄로 갈라진다
})

it('고른 축의 좌표 차이가 0이어도(같은 높이에서 가로로 겹침) 정해진 방향으로 갈라진다',()=>{
 const [a,b]=run([node('a',0,0,'가나다라마바사',6),node('b',10,0,'가나다라마바사',6)]) // 가로로 86 겹치고 세로로 35.6 겹쳐 세로 분기로 가지만 dy는 0이다
 expect(a.vy).toBeLessThan(0)
 expect(b.vy).toBeGreaterThan(0)
 const [c]=run([node('c',0,0,'가',6),node('d',0,0,'가',6)])
 expect(Math.hypot(c.vx,c.vy)).toBeGreaterThan(0) // 완전히 같은 자리는 그대로 갈라진다
 const [e,g]=run([node('e',0,0,'가',6),node('g',200,200,'가',6)])
 expect([e.vx,e.vy,g.vx,g.vy]).toEqual([0,0,0,0]) // 떨어진 둘은 건드리지 않는다
})

it('크기 슬라이더가 커지면 상자도 커져 전에는 겹치지 않던 둘이 겹친다',()=>{
 const small=run([node('a',0,0,'가',6),node('b',0,40,'가',6)],1,1)
 expect(small[0].vy).toBe(0)
 const big=run([node('a',0,0,'가',6),node('b',0,40,'가',6)],1,2)
 expect(big[0].vy).toBeLessThan(0)
})

it('힘의 세기가 한 번에 겹침을 다 풀지 않고(strength) alpha와 상관없이 같은 비율로 움직여 식은 뒤에도 풀린다',()=>{
 const hot=run([node('a',0,0),node('b',10,0)],1),cool=run([node('a',0,0),node('b',10,0)],0.01)
 expect(cool[0].vx).toBe(hot[0].vx)
 expect(Math.abs(hot[0].vx)).toBeGreaterThan(0)
 const overlap=labelBox('이름',6).halfW*2+4-10 // 겹친 만큼
 expect(Math.abs(hot[0].vx)).toBeLessThan(overlap/2) // 한 번에 다 풀지 않는다(속도에 더한다)
})
