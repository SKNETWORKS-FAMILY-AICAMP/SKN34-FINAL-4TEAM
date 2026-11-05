import { describe, expect, it } from 'vitest'
import type { StoryPlan } from '../../../../domain/entities/storyPlan'
import { deletionFocusOrder } from './deletionFocus'

const plot = (id: string): StoryPlan => ({ id, workId: 'w', kind: 'plot', parentId: null, title: id, content: '', episodeNumber: null, characterIds: [], placeIds: [], revision: 1, episodeMissing: false })
const scene = (id: string, parentId = 'p'): StoryPlan => ({ ...plot(id), kind: 'scene', parentId })

describe('삭제 후 포커스 순서 · DOM 없는 단위', () => {
  const rows = [plot('p'), scene('a'), scene('b'), scene('c'), plot('other'), scene('foreign', 'other')]
  it.each([
    ['a', ['b', 'c']],
    ['b', ['c', 'a']],
    ['c', ['b', 'a']],
    ['p', ['other']],
    ['other', ['p']],
  ])('%s 삭제 시 같은 목록의 다음 항목부터 이전 항목 순으로 복귀한다', (id, expected) => {
    expect(deletionFocusOrder(rows, rows.find(row => row.id === id)!)).toEqual(expected)
  })
  it('마지막 항목은 추가 버튼으로 복귀하도록 후보를 비운다', () => {
    expect(deletionFocusOrder([plot('p')], plot('p'))).toEqual([])
    expect(deletionFocusOrder([plot('p'), scene('a')], scene('a'))).toEqual([])
  })
  it('현재 목록에 없는 대상이나 다른 작품의 항목을 포커스 후보로 사용하지 않는다', () => {
    expect(deletionFocusOrder(rows, scene('missing'))).toEqual([])
    expect(deletionFocusOrder([plot('p'), { ...plot('foreign'), workId: 'other-work' }], plot('p'))).toEqual([])
  })
})
