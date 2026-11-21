import { expect, it } from 'vitest'
import { clampMenu, createGrid, overlaps, type Box } from './canvasLayout'

const box=(cx:number,cy:number,w=40,h=20):Box=>({cx,cy,w,h})

it('overlaps는 두 축 모두 겹칠 때만 겹침으로 보고 gap까지는 가까워도 겹친 것으로 본다',()=>{
 expect(overlaps(box(0,0),box(39,0))).toBe(true) // 가로 간격 1 겹침
 expect(overlaps(box(0,0),box(40,0))).toBe(false) // 맞닿음은 겹침이 아니다
 expect(overlaps(box(0,0),box(39,19))).toBe(true)
 expect(overlaps(box(0,0),box(39,20))).toBe(false) // 한 축만 멀어도 겹치지 않는다
 expect(overlaps(box(0,0),box(43,0),4)).toBe(true) // gap 4: 40+4 안쪽
 expect(overlaps(box(0,0),box(44,0),4)).toBe(false)
})

it('createGrid는 가까운 상자끼리만 겹침을 가르고 같은 id의 상자는 자기 자신으로 보아 비교하지 않으며 멀리 떨어진 칸은 보지 않는다',()=>{
 const grid=createGrid<Box&{id?:string}>(3)
 grid.add({...box(0,0),id:'a'})
 expect(grid.hits({...box(30,0),id:'b'})).toBe(true)
 expect(grid.hits({...box(30,0),id:'a'})).toBe(false) // 같은 id는 자기 자신
 expect(grid.hits(box(37,0))).toBe(true) // gap 3 안
 expect(grid.hits(box(44,0))).toBe(false)
 expect(grid.hits(box(5000,5000))).toBe(false) // 먼 칸
 grid.add({...box(-1000,-1000,600,600),id:'wide'}) // 여러 칸에 걸친 큰 상자
 expect(grid.hits(box(-1200,-900))).toBe(true)
 expect(grid.hits(box(-1000,-1000,10,10))).toBe(true)
 expect(grid.hits(box(-1400,-1000,10,10))).toBe(false)
})

it('clampMenu는 메뉴가 화면 오른쪽·아래로 넘치지 않게 안쪽으로 당기고 가장자리 여백(8px)을 지킨다',()=>{
 const size={w:200,h:300},view={w:1000,h:700}
 expect(clampMenu({x:100,y:100},size,view)).toEqual({x:100,y:100}) // 넘치지 않으면 그대로
 expect(clampMenu({x:950,y:100},size,view)).toEqual({x:792,y:100}) // 1000 − 200 − 8
 expect(clampMenu({x:100,y:650},size,view)).toEqual({x:100,y:392}) // 700 − 300 − 8
 expect(clampMenu({x:-20,y:-5},size,view)).toEqual({x:8,y:8})
 expect(clampMenu({x:10,y:10},{w:2000,h:2000},view)).toEqual({x:8,y:8}) // 화면보다 큰 메뉴는 왼쪽 위에 붙인다
})
