import { expect, it } from 'vitest'
import { DOT_MAX, DOT_MIN, ZOOM_TO_NODE, degrees, dotDiameter, labelLimit, topDegreeIds, zoomLevel } from './zoomLevel'

it('zoomLevel은 0.5 미만 far, 0.5 이상 0.9 미만 mid, 0.9 이상 near이고 경계값은 위쪽 단계다',()=>{
 expect([0.15,0.3,0.49,0.4999].map(zoomLevel)).toEqual(['far','far','far','far'])
 expect([0.5,0.7,0.89,0.8999].map(zoomLevel)).toEqual(['mid','mid','mid','mid'])
 expect([0.9,1,1.75].map(zoomLevel)).toEqual(['near','near','near'])
 expect(zoomLevel(ZOOM_TO_NODE)).toBe('mid') // 점을 눌러 이동하는 배율은 near 바로 아래다
})

it('degrees는 관계 하나가 양쪽 끝 카드에 한 번씩 더해지고 관계가 없는 카드는 0이며 모르는 끝점은 세지 않는다',()=>{
 const d=degrees(['a','b','c','d'],[{source:'a',target:'b'},{source:'a',target:'c'},{source:'a',target:'b'},{source:'a',target:'zzz'}])
 expect([...d]).toEqual([['a',4],['b',2],['c',1],['d',0]])
})

it('dotDiameter는 관계가 없으면 최소, 가장 많으면 최대이고 그 사이는 관계가 많을수록 커지며(면적이 관계 수에 비례) 모두가 0이어도 깨지지 않는다',()=>{
 expect(dotDiameter(0,10)).toBe(DOT_MIN)
 expect(dotDiameter(10,10)).toBe(DOT_MAX)
 expect(dotDiameter(0,0)).toBe(DOT_MIN)
 const sizes=[0,1,2,5,10].map(n=>dotDiameter(n,10))
 expect([...sizes].sort((x,y)=>x-y)).toEqual(sizes) // 늘기만 한다
 expect(new Set(sizes).size).toBe(sizes.length)
 // 중간 값은 선형이 아니라 √ 비례: 관계 수가 1/4이면 지름은 절반 쪽(MIN 위로 늘어나는 폭의 절반)
 expect(dotDiameter(2.5,10)).toBe(Math.round(DOT_MIN+(DOT_MAX-DOT_MIN)/2))
})

it('labelLimit은 카드가 적어도 3개, 많아도 12개이고 그 사이는 약 10%다',()=>{
 expect([0,5,30,31,100,1000].map(labelLimit)).toEqual([3,3,3,4,10,12])
})

it('topDegreeIds는 관계가 있는 카드 중 관계가 많은 쪽부터 limit개(같으면 앞선 카드)이고 관계 없는 카드는 뽑지 않는다',()=>{
 const order=['a','b','c','d','e','f']
 const degree=new Map([['a',1],['b',5],['c',5],['d',0],['e',2],['f',0]])
 expect([...topDegreeIds(order,degree,3)]).toEqual(['b','c','e'])
 expect([...topDegreeIds(order,degree,10)]).toEqual(['b','c','e','a']) // 관계 없는 d·f는 limit이 남아도 뽑지 않는다
 expect(topDegreeIds(order,new Map(order.map(id=>[id,0])),3).size).toBe(0)
})
