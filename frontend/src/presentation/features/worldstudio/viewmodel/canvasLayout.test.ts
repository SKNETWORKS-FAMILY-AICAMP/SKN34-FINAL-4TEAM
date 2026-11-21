import { expect, it } from 'vitest'
import { clampMenu, freeSpot, gridLayout, validConnection } from './canvasLayout'

const node=(id:string,unnamed=false)=>({id,unnamed})

it('gridLayout은 카드를 넣은 순서대로 격자(열 수 ≈ √(1.5n))에 깔고 서로 겹치지 않으며 카드 하나는 원점이다',()=>{
 expect(gridLayout([node('a')]).get('a')).toEqual({x:0,y:0})
 const nodes=Array.from({length:20},(_,i)=>node('n'+i))
 const spots=[...gridLayout(nodes).values()]
 expect(new Set(spots.map(p=>p.x+':'+p.y)).size).toBe(20)
 expect(Math.max(...spots.map(p=>p.x))/344+1).toBe(6) // ceil(√30)=6열
 for(let i=0;i<spots.length;i++)for(let j=i+1;j<spots.length;j++)expect(Math.abs(spots[i].x-spots[j].x)>=200||Math.abs(spots[i].y-spots[j].y)>=150).toBe(true)
})

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
