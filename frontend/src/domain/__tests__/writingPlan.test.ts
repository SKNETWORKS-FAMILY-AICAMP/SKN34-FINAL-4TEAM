import { expect, it } from 'vitest'
import { scenePlans, planStartBlocker } from '../entities/storyPlan'

it('미저장 또는 처리 중 계획으로 시뮬레이션을 시작하지 않는다', () => {
  expect(planStartBlocker({ dirty: true, busy: false })).toContain('저장')
  expect(planStartBlocker({ dirty: false, busy: true })).toContain('처리')
  expect(planStartBlocker({ dirty: false, busy: false })).toBe('')
})
it('회차별 장면을 저장 순서로 고르고 사라진 회차와 다른 회차는 제외한다', () => {
  const a = { kind: 'scene' as const, parentId: 'p', title: 'A', content: '', episodeNumber: 1, characterIds: [], placeIds: [], id: 'a', workId: 'w', revision: 1, episodeMissing: false, position: 2 }
  const b = { ...a, id: 'b', parentId: 'q', position: 0 }
  expect(scenePlans([a, { ...b, id: 'other', episodeNumber: 2 }, b, { ...b, id: 'missing', episodeMissing: true }], 1).map(p => p.id)).toEqual(['b', 'a'])
})
