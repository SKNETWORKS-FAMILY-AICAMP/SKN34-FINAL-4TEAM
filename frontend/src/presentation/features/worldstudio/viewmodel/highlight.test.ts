import { expect, it } from 'vitest'
import { focusStyle, neighborhood } from './highlight'

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

it('focusStyle은 강조 대상이 아닌 노드·선을 흐리게 하고(클릭은 되는 opacity) 대상 선을 굵고 또렷하게 하며, id의 따옴표·역슬래시를 막는다',()=>{
 const css=focusStyle(new Set(['a','b']),new Set(['e1']))
 expect(css).toContain('.relationship-flow .react-flow__node:not([data-id="a"],[data-id="b"]){opacity:.18}')
 expect(css).toContain('.relationship-flow .relationship-edge:not([data-edge="e1"],:hover,:focus-within){opacity:.15}') // 마우스를 올리거나 초점이 간 선은 흐리지 않는다(편집·삭제 버튼이 그 안에 있다)
 expect(css).toMatch(/\.relationship-edge:is\(\[data-edge="e1"\]\) > path:first-child\{stroke:var\(--edge-active\);stroke-width:3px\}/)
 expect(css).not.toContain('pointer-events') // 흐린 노드·선도 눌린다
 const edgeless=focusStyle(new Set(['a']),new Set())
 expect(edgeless).toContain('.relationship-flow .relationship-edge:not(:hover,:focus-within){opacity:.15}') // 닿는 선이 없으면 모든 선이 흐리다
 expect(edgeless).not.toContain(':not()')
 expect(focusStyle(new Set(),new Set())).toBe('') // 강조 대상이 없으면 아무것도 흐리지 않는다
 expect(focusStyle(new Set(['x"y\\z']),new Set())).toContain('[data-id="x\\"y\\\\z"]')
})
