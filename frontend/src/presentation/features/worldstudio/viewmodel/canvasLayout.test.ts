import { expect, it } from 'vitest'
import { clampMenu, freeSpot, validConnection } from './canvasLayout'

const node=(id:string,unnamed=false)=>({id,unnamed})

it('freeSpot은 원하는 자리가 비어 있으면 그대로, 다른 카드와 겹치면 가까운 빈 자리로 옮기며 같은 입력에는 같은 답이다',()=>{
 expect(freeSpot({x:10,y:20},[])).toEqual({x:10,y:20})
 expect(freeSpot({x:500,y:0},[{x:0,y:0}])).toEqual({x:500,y:0})
 const occupied=[{x:0,y:0},{x:40,y:0}]
 const spot=freeSpot({x:0,y:0},occupied)
 expect(spot).not.toEqual({x:0,y:0})
 for(const p of occupied)expect(Math.abs(spot.x-p.x)>=200||Math.abs(spot.y-p.y)>=150).toBe(true)
 expect(freeSpot({x:0,y:0},occupied)).toEqual(spot)
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
