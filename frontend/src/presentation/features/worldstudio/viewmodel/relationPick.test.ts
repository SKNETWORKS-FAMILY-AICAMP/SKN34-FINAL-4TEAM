import { expect, it } from 'vitest'

import { pickRelationNode } from './relationPick'

it('그래프에서 처음 누른 노드는 관계 주체가 되고 상대를 고르는 중이 된다(폼은 아직 열지 않는다)', () => {
  expect(pickRelationNode({ source: '', choosing: false }, 'a')).toEqual({ source: 'a', target: '', open: false, choosing: true })
})

it('상대를 고르는 중에 다른 노드를 누르면 주체·대상을 채우고 관계 작성을 연다', () => {
  expect(pickRelationNode({ source: 'a', choosing: true }, 'b')).toEqual({ source: 'a', target: 'b', open: true, choosing: false })
})

it('상대를 고르는 중에 주체 노드를 다시 누르면 고르기를 멈춘다(자기 자신과는 이을 수 없다)', () => {
  expect(pickRelationNode({ source: 'a', choosing: true }, 'a')).toEqual({ source: 'a', target: '', open: false, choosing: false })
})

it('이미 고른 관계가 있어도 고르는 중이 아니면 눌린 노드가 새 주체가 된다', () => {
  expect(pickRelationNode({ source: 'a', choosing: false }, 'c')).toEqual({ source: 'c', target: '', open: false, choosing: true })
})
