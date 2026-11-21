import { expect, it } from 'vitest'
import { GAP, bodyBox, clampMenu, legalize, nearestFree, overlaps, validConnection, type Box } from './canvasLayout'

const node=(id:string,unnamed=false)=>({id,unnamed})
const box=(cx:number,cy:number,w=200,h=150):Box=>({cx,cy,w,h})
const clear=(boxes:Box[])=>{for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)if(overlaps(boxes[i],boxes[j]))return false;return true}

it('overlaps는 간격(GAP 16)까지 겹침으로 본다: 맞닿거나 16px 안으로 가까운 상자는 겹친 것이고, 두 축 모두 가까울 때만 겹친다',()=>{
 expect(GAP).toBe(16)
 expect(overlaps(box(0,0),box(215,0))).toBe(true) // 가로 간격 15 < 16
 expect(overlaps(box(0,0),box(216,0))).toBe(false)
 expect(overlaps(box(0,0),box(0,165))).toBe(true) // 세로: 카드 높이 150 + 간격 16 = 166
 expect(overlaps(box(0,0),box(0,166))).toBe(false)
 expect(overlaps(box(0,0),box(215,165))).toBe(true)
 expect(overlaps(box(0,0),box(216,10))).toBe(false) // 한 축만 멀어도 겹치지 않는다
 expect(overlaps(box(0,0,200,200),box(0,190,200,150))).toBe(true) // 지름 200의 점은 카드 높이(150)를 넘어 세로 간격이 (200+150)/2+16=191까지 필요하다
 expect(overlaps(box(0,0,200,200),box(0,191,200,150))).toBe(false)
})

it('bodyBox는 가까이의 카드(200×150)와 멀리·중간의 점(지름 d) 중 큰 쪽이라 어느 단계에서나 겹치지 않는 기준이다',()=>{
 expect(bodyBox(44)).toEqual({w:200,h:150})
 expect(bodyBox(150)).toEqual({w:200,h:150})
 expect(bodyBox(200)).toEqual({w:200,h:200})
 expect(bodyBox(260)).toEqual({w:260,h:260})
})

it('nearestFree는 원하는 자리가 비어 있으면 그대로, 겹치면 가장 가까운 빈 자리(간격 포함)로 옮기며 같은 입력에는 같은 답이다',()=>{
 expect(nearestFree(box(10,20),[])).toEqual(box(10,20))
 expect(nearestFree(box(800,0),[box(0,0)])).toEqual(box(800,0))
 const others=[box(0,0),box(40,0),box(-30,50)]
 const spot=nearestFree(box(0,0),others)
 expect(spot.w).toBe(200);expect(spot.h).toBe(150)
 for(const o of others)expect(overlaps(spot,o)).toBe(false)
 expect(Math.hypot(spot.cx,spot.cy)).toBeLessThan(450) // 가까운 빈 자리다(멀리 날아가지 않는다)
 expect(nearestFree(box(0,0),others)).toEqual(spot)
 expect(nearestFree(box(0,0),[box(0,0,200,200)]).cy).not.toBe(0) // 점 크기만큼 비켜 간다
})

it('legalize는 겹친 상자를 큰 것부터 두고 나머지를 가까운 빈 자리로 밀어 겹침이 0이고, 이미 떨어진 상자는 움직이지 않으며, 순서·크기를 지키고 결정적이다',()=>{
 const apart=[box(0,0),box(300,0),box(0,300)]
 expect(legalize(apart)).toEqual(apart)
 const pile=Array.from({length:30},(_,i)=>box(i*3,i%5,i%4===0?200:200,i%4===0?200:150))
 const placed=legalize(pile)
 expect(placed).toHaveLength(30)
 expect(clear(placed)).toBe(true)
 placed.forEach((b,i)=>{expect(b.w).toBe(pile[i].w);expect(b.h).toBe(pile[i].h)})
 const biggest=pile.findIndex(b=>b.h===200)
 expect(placed[biggest]).toEqual(pile[biggest]) // 가장 큰 상자(같으면 앞선 것)는 제자리
 expect(legalize(pile)).toEqual(placed)
})

it('validConnection은 자기 자신·없는 카드·이름 없는 카드를 막고 이름 있는 두 카드는 허용한다',()=>{
 const byId=new Map([node('a'),node('b'),node('c',true)].map(n=>[n.id,n]))
 expect(validConnection({source:'a',target:'b'},byId)).toBe(true)
 expect(validConnection({source:'a',target:'a'},byId)).toBe(false)
 expect(validConnection({source:'a',target:'zzz'},byId)).toBe(false)
 expect(validConnection({source:'c',target:'a'},byId)).toBe(false)
 expect(validConnection({source:'a',target:'c'},byId)).toBe(false)
})

it('clampMenu는 메뉴가 화면 오른쪽·아래로 넘치지 않게 안쪽으로 당기고 가장자리 여백(8px)을 지킨다',()=>{
 const view={w:1000,h:700},size={w:200,h:300}
 expect(clampMenu({x:100,y:100},size,view)).toEqual({x:100,y:100}) // 넘치지 않으면 그대로
 expect(clampMenu({x:950,y:100},size,view)).toEqual({x:792,y:100}) // 1000 − 200 − 8
 expect(clampMenu({x:100,y:650},size,view)).toEqual({x:100,y:392}) // 700 − 300 − 8
 expect(clampMenu({x:-20,y:-5},size,view)).toEqual({x:8,y:8})
 expect(clampMenu({x:10,y:10},{w:2000,h:2000},view)).toEqual({x:8,y:8}) // 화면보다 큰 메뉴는 왼쪽 위에 붙인다
})
