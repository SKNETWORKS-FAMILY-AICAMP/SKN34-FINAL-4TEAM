import { expect, it } from 'vitest'
import { presentationMapLayout } from './presentationMapLayout'
import type { MapNode } from './useWorldMapViewModel'

const node=(id:string,kind:MapNode['kind']):MapNode=>({id,name:id,kind,text:'',tags:[]})
it('places people in a centered row and other settings on an ellipse, pinned in place',()=>{
 const [a,b,c,place]=presentationMapLayout([node('a','인물'),node('b','인물'),node('c','인물'),node('p','장소')])
 expect([a.x,b.x,c.x]).toEqual([-160,0,160])
 expect([a.y,b.y,c.y]).toEqual([-40,55,-40])
 expect(place.x).toBeCloseTo(0)
 expect(place.y).toBeCloseTo(-210)
 expect(a.fx).toBe(a.x)
 expect(place.fy).toBe(place.y)
})
