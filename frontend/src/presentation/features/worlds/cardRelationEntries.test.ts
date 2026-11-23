import { expect, it } from 'vitest'
import type { PublicWorld } from '../../../domain/entities/publicWorld'
import { publicCardEntries } from './cardRelationEntries'
import { cardPage } from './worldDetail'

const world: PublicWorld = {
  id: 'w', name: '시험', description: '', genre: 'genre-01', genreName: '판타지', authorNickname: '작가', publishedAt: '2026-11-01T00:00:00Z', revisionNo: 1, relationshipStatus: 'current',
  cards: [['0', '길동', 'character'], ['1', '홍문', 'character'], ['2', '전투', 'event'], ['3', '항구', 'location']].map(([id, title, cardType]) => ({ id, title, text: title + ' 설명', cardType: cardType as 'character', aliases: [], tags: [] })),
  relationships: [
    { id: 'r1', sourceCardId: '0', targetCardId: '1', label: '아버지', category: 'structural', direction: 'directed', history: [{ episode: 1, label: '경계', body: '' }, { episode: 3, label: '보호', body: '' }] },
    { id: 'r2', sourceCardId: '1', targetCardId: '0', label: '아들', category: 'structural', direction: 'directed' },
    { id: 'r3', sourceCardId: '0', targetCardId: '2', label: '참여', category: 'structural', direction: 'symmetric' },
    { id: 'r4', sourceCardId: '0', targetCardId: '3', label: '무시되는 이름', category: 'identity', direction: 'symmetric' },
  ],
}

it('이 카드에 문단으로 보이는 관계와 이 카드를 가리키는 단방향 관계를 관계도 입력으로 바꾼다(이력이 있으면 이력, 없으면 현재 이름 하나·회차 모름, 동일 인물은 이름이 고정)', () => {
  const entries = publicCardEntries(cardPage(world, '0')!)
  expect(entries.map((e) => [e.id, e.otherId, e.otherTitle, e.otherKind, e.steps])).toEqual([
    ['r1', '1', '홍문', '인물', [{ name: '경계', episode: 1 }, { name: '보호', episode: 3 }]], // 이름이 바뀐 이력
    ['r4', '3', '항구', '장소', [{ name: '동일 인물', episode: null }]], // 설정집 순서(인물 → 장소 → … → 사건)를 따른다
    ['r3', '2', '전투', '사건', [{ name: '참여', episode: null }]],
    ['r2', '1', '홍문', '인물', [{ name: '아들', episode: null }]], // 이 카드를 가리키는 단방향 관계(받는 쪽)
  ])
})

it('본문 링크로만 가리킨 카드(관계 id 없음)는 관계가 아니라 뺀다', () => {
  const page = cardPage(world, '0')!
  expect(publicCardEntries({ ...page, relations: [], backlinks: [{ ...page.backlinks[0], relationId: undefined, label: '본문 링크' }] })).toEqual([])
})
