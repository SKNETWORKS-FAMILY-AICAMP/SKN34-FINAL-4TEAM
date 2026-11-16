import { describe, expect, it } from 'vitest'

import { seedWorks, seedWorlds } from '../../data/mock/seed'
import { canReport, canView, forkLabel, forkList, makeFork, sameAuthorWorks, similarWorks, type Work } from '../entities/work'

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

  it('신고는 남의 공개 작품에만 열린다 — 비공개·숨김·본인 작품은 불가 (#196)', () => {
    const others = byId('postman')
    expect(canReport(others, 'member-1')).toBe(true)
    expect(canReport({ ...others, private: true }, 'member-1')).toBe(false)
    expect(canReport({ ...others, hidden: true }, 'member-1')).toBe(false)
    expect(canReport(byId('starlight'), 'member-1')).toBe(false)
  })

  it('서버 작품은 canonical이어도 소유자 회원 ID·mine 표시로 본인 작품을 가른다 — 검색 카드는 mine을 모른다 (#196)', () => {
    const server = { ...byId('postman'), canonical: true, owner: 'owner-uuid', mine: false }
    expect(canReport(server, 'reader-uuid')).toBe(true)
    expect(canReport(server, null)).toBe(true)
    expect(canReport(server, 'owner-uuid')).toBe(false)
    expect(canReport({ ...server, mine: true }, 'reader-uuid')).toBe(false)
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

describe('소설 상세 추천 선정 규칙', () => {
  const wk = (id: string, over: Partial<Work> = {}): Work => ({ ...byId('guunmong'), id, title: id, author: '작가', hash: [], ...over })
  const ids = (list: Work[]) => list.map((w) => w.id)

  it('같은 작가의 다른 작품은 작가명이 정확히 같은 것만 현재 작품을 빼고 검색 순서대로 남긴다', () => {
    const cur = wk('cur', { author: '윤서하' })
    const found = [wk('a', { author: '윤서하' }), wk('cur', { author: '윤서하' }), wk('b', { author: '윤서하윤' }), wk('c', { author: '하윤서하' }), wk('d', { author: '윤서하' })]
    expect(ids(sameAuthorWorks(cur, found))).toEqual(['a', 'd'])
  })

  it('탈퇴한 회원은 이름이 모두 같아 같은 작가로 보지 않는다', () => {
    expect(sameAuthorWorks(wk('cur', { author: '탈퇴한 회원' }), [wk('a', { author: '탈퇴한 회원' })])).toEqual([])
  })

  it('비슷한 작품은 현재 작품과 같은 작가 목록을 빼고 해시태그가 많이 겹치는 순, 동점은 검색 순서 그대로다', () => {
    const cur = wk('cur', { hash: ['#a', '#b', '#c'] })
    const found = [wk('x', { hash: ['#z'] }), wk('y', { hash: ['#a'] }), wk('cur', { hash: ['#a', '#b', '#c'] }), wk('s', { hash: ['#a', '#b', '#c'] }), wk('w', { hash: ['#b', '#a'] }), wk('v', { hash: ['#b'] }), wk('u')]
    expect(ids(similarWorks(cur, found, [wk('s')]))).toEqual(['w', 'y', 'v', 'x', 'u'])
  })

  it('비슷한 작품은 오른쪽 포크 박스와 겹치는 현재 작품의 포크·원작·같은 원작의 형제 포크를 빼고 무관한 작품은 남긴다', () => {
    const cur = wk('cur', { parent: 'src', hash: ['#a'] })
    const found = [wk('src', { hash: ['#a'] }), wk('sib', { parent: 'src', hash: ['#a'] }), wk('kid', { parent: 'cur', hash: ['#a'] }), wk('other', { hash: ['#a'] }), wk('otherFork', { parent: 'other', hash: ['#a'] })]
    expect(ids(similarWorks(cur, found))).toEqual(['other', 'otherFork'])
  })

  it('원작은 자기 포크만 빼고, 원작끼리는 부모가 없다는 이유로 서로 형제로 보지 않는다', () => {
    const cur = wk('cur', { hash: ['#a'] })
    const found = [wk('kid1', { parent: 'cur' }), wk('kid2', { parent: 'cur' }), wk('plain'), wk('stranger', { parent: 'stranger-src' })]
    expect(ids(similarWorks(cur, found))).toEqual(['plain', 'stranger'])
  })

  it('해시태그가 없는 작품끼리는 검색의 인기 순을 그대로 둔다', () => {
    expect(ids(similarWorks(wk('cur', { hash: undefined }), [wk('p', { hash: undefined }), wk('q'), wk('r')]))).toEqual(['p', 'q', 'r'])
  })

  it('두 목록 모두 최대 6개이고 받은 배열은 바꾸지 않는다', () => {
    const many = Array.from({ length: 9 }, (_, i) => wk(`m${i}`, { hash: i === 8 ? ['#a'] : [] }))
    const before = ids(many)
    expect(ids(sameAuthorWorks(wk('cur'), many))).toEqual(before.slice(0, 6))
    expect(ids(similarWorks(wk('cur', { hash: ['#a'] }), many))).toEqual(['m8', 'm0', 'm1', 'm2', 'm3', 'm4'])
    expect(ids(many)).toEqual(before)
  })
})
