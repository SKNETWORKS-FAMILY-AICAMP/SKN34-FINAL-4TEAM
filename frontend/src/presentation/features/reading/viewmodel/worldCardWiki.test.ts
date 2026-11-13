import { expect, it } from 'vitest'

import type { ReaderWorldCard, ReaderWorldCards } from '../../../../domain/entities/wiki'
import { CARD_COLORS } from '../../../shared/worldBoard'
import { worldCardWiki } from './worldCardWiki'

const card = (id: string, extra: Partial<ReaderWorldCard> = {}): ReaderWorldCard => ({ id, title: id, text: `${id} 본문`, cardType: 'character', aliases: [], tags: [], revealFromEpisode: 1, ...extra })
const relation = (sourceCardId: string, targetCardId: string, label = '') => ({ id: `${sourceCardId}-${targetCardId}-${label}`, sourceCardId, targetCardId, label })
const wiki = (cards: ReaderWorldCard[], relationships: ReaderWorldCards['relationships'] = []) => worldCardWiki({ cards, relationships })

it('카드 유형 순서(인물·장소·조직·능력·사물·규칙·사건·기타)의 분류와 공개 세계관과 같은 유형 색을 준다', () => {
  const { cats } = wiki([])
  expect(cats.map((c) => [c.id, c.n])).toEqual([
    ['character', '인물'], ['location', '장소'], ['organization', '조직'], ['ability', '능력'], ['object', '사물'], ['rule', '규칙'], ['event', '사건'], ['other', '기타'],
  ])
  expect(cats.map((c) => c.c)).toEqual([CARD_COLORS.인물, CARD_COLORS.장소, CARD_COLORS.조직, CARD_COLORS.기타, CARD_COLORS.기타, CARD_COLORS.규칙, CARD_COLORS.사건, CARD_COLORS.기타])
})

it('카드를 마크다운 본문·별칭·태그·독자 공개 시작 회차를 가진 그 유형의 문서로 바꾼다', () => {
  const [rian, seal] = wiki([
    card('rian', { title: '리안', text: '## 성격\n끈질기다', aliases: ['견습 서약사'], tags: ['주인공', '서약사'], revealFromEpisode: 2 }),
    card('seal', { title: '봉인 규칙', cardType: 'rule' }),
  ]).docs
  expect(rian).toEqual({ id: 'rian', cat: 'character', t: '리안', alias: ['견습 서약사'], tags: ['주인공', '서약사'], at: {}, body: '## 성격\n끈질기다', markdown: true, links: [], props: { 태그: '주인공, 서약사', 공개: '2화부터' } })
  // 태그가 없으면 태그 행을 만들지 않는다.
  expect([seal.cat, seal.props]).toEqual(['rule', { 공개: '1화부터' }])
})

it('관계는 양 끝 문서 모두에 상대 문서로 가는 연결이 되고, 자기 자신과의 관계와 같은 상대·같은 라벨의 중복은 뺀다', () => {
  const { docs } = wiki([card('a'), card('b'), card('c')], [
    relation('a', 'b', '스승'), relation('b', 'a', '스승'), relation('b', 'a', '경쟁'), relation('c', 'a'), relation('c', 'c', '자기'),
  ])
  const links = Object.fromEntries(docs.map((d) => [d.id, d.links]))
  expect(links).toEqual({
    a: [{ to: 'b', k: '스승' }, { to: 'b', k: '경쟁' }, { to: 'c', k: '' }],
    b: [{ to: 'a', k: '스승' }, { to: 'a', k: '경쟁' }],
    c: [{ to: 'a', k: '' }],
  })
})
