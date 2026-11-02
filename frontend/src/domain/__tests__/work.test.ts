import { describe, expect, it } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import { canView, forkLabel, forkList, makeFork } from '../entities/work'

const works = seedWorks(0)
const worlds = seedWorlds()
const byId = (id: string) => works.find((w) => w.id === id)!

describe('작품 규칙 (목업 1절)', () => {
  it('회차별 포크 허용을 계산하고 비허용 작품은 빈 목록을 돌려준다', () => {
    expect(forkList(byId('guunmong'), worlds)).toEqual([2, 3, 4])
    expect(forkList(byId('postman'), worlds)).toEqual([1, 2])
    expect(forkList(byId('hong'), worlds)).toEqual([])
    expect(forkList(byId('gate'), worlds)).toEqual([])
    expect(forkLabel(byId('guunmong'), worlds)).toBe('2·3·4화 포크 허용')
    expect(forkLabel(byId('postman'), worlds)).toBe('전체 회차 포크 허용')
    expect(forkLabel(byId('hong'), worlds)).toBe('포크 비허용')
  })

  it('숨긴 회차 이후와 비공개 세계관이 연결된 작품은 포크할 수 없다', () => {
    const w = structuredClone(byId('guunmong'))
    w.eps[2].hidden = true
    expect(forkList(w, worlds)).toEqual([2])
    expect(forkList({ ...byId('guunmong'), worldIds: ['private-world'] }, worlds)).toEqual([])
  })

  it('비공개 작품은 본인(일반 회원)만 볼 수 있다', () => {
    const mine = { ...byId('starlight'), private: true }
    expect(canView(mine, null)).toBe(false)
    expect(canView(mine, 'user')).toBe(true)
    expect(canView({ ...byId('postman'), private: true }, 'user')).toBe(false)
  })

  it('포크 스냅샷은 분기 회차까지 공개된 규칙·인물·사건만 복사하고 원작과 분리된다', () => {
    const parent = structuredClone(byId('guunmong'))
    const f = makeFork(parent, 3, { id: 'f1', title: 't', author: '나' }, 0)
    expect(f.snap!.eps).toHaveLength(3)
    expect(f.snap!.rules).not.toContain('양소유는 전생(성진)을 기억하지 못한다')
    expect(f.snap!.cast.map((c) => c.n)).toEqual(['성진', '육관대사', '팔선녀'])
    expect(f.snap!.events.every((e) => e[0] <= 3)).toBe(true)
    expect(f.by).toBe('포크 · 원작 「구운몽」 3화에서 포크 · 나')
    parent.eps[0].p[0] = '바뀐 원작'
    expect(f.snap!.eps[0].p[0]).not.toBe('바뀐 원작')
  })
})
