import { expect, it } from 'vitest'
import { neighborhood } from './highlight'

const links=[{id:'e1',source:'a',target:'b'},{id:'e2',source:'c',target:'a'},{id:'e3',source:'b',target:'c'},{id:'e4',source:'d',target:'d'},{id:'e5',source:'a',target:'b'}]

it('neighborhood는 그 노드·직접 이어진 이웃·그 노드에 닿는 선을 돌려준다(방향·중복 선과 상관없이, 이웃끼리의 선은 아니다)',()=>{
 const a=neighborhood('a',links)
 expect([...a.nodes].sort()).toEqual(['a','b','c'])
 expect([...a.edges].sort()).toEqual(['e1','e2','e5']) // b↔c의 e3은 이웃끼리라 빠진다
 const b=neighborhood('b',links)
 expect([...b.nodes].sort()).toEqual(['a','b','c'])
 expect([...b.edges].sort()).toEqual(['e1','e3','e5'])
})

it('관계가 없는 노드나 자기 자신으로 가는 선뿐인 노드는 자기 자신만, 그래프에 없는 id는 선 없이 자기 자신만 돌려준다',()=>{
 expect([...neighborhood('z',links).nodes]).toEqual(['z'])
 expect(neighborhood('z',links).edges.size).toBe(0)
 const d=neighborhood('d',links)
 expect([...d.nodes]).toEqual(['d'])
 expect([...d.edges]).toEqual(['e4'])
})
