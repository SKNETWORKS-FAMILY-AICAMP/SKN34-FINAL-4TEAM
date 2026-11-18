import { expect, it } from 'vitest'

import type { ReaderWorldCard, ReaderWorldCards } from '../../../../domain/entities/wiki'
import { CARD_COLORS } from '../../../shared/worldBoard'
import { worldCardWiki } from './worldCardWiki'

const card = (id: string, extra: Partial<ReaderWorldCard> = {}): ReaderWorldCard => ({ id, title: id, text: `${id} 본문`, cardType: 'character', aliases: [], tags: [], revealFromEpisode: 1, ...extra })
const relation = (sourceCardId: string, targetCardId: string, label = '') => ({ id: `${sourceCardId}-${targetCardId}-${label}`, sourceCardId, targetCardId, label })
const wiki = (cards: ReaderWorldCard[], relationships: ReaderWorldCards['relationships'] = [], basis: Pick<ReaderWorldCards, 'workId' | 'upto'> = { workId: 'work-1', upto: 3 }) => worldCardWiki({ ...basis, cards, relationships })

it('같은 라벨의 역방향·대칭 관계와 부정·본문을 양 끝 문서에 각각 보존한다', () => {
  const links = wiki([card('a'), card('b')], [
    { id: '1', sourceCardId: 'a', targetCardId: 'b', label: '동료', category: 'emotional', direction: 'directed', polarity: 'denied', body: '근거\n원문' },
    { id: '2', sourceCardId: 'b', targetCardId: 'a', label: '동료', direction: 'symmetric' },
    { id: '3', sourceCardId: 'b', targetCardId: 'a', label: '동료' },
  ]).docs.map((d) => d.links!)
  expect(links.map((items) => items.length)).toEqual([3, 3])
  expect(links[0][0]).toMatchObject({ to: 'b', k: '동료', relation: { category: 'emotional', direction: 'directed', polarity: 'denied', body: '근거\n원문', sourceFirst: true } })
  expect(links[1][0].relation?.sourceFirst).toBe(false)
  expect(links[0][1].relation?.direction).toBe('symmetric')
  expect(links[0][2].relation?.direction).toBeUndefined()
})

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

it('이미지가 있는 카드는 독자 설정 위키 이미지 주소(작품·이미지 id·위키와 같은 기준 회차)를 문서에 싣고, 없으면 싣지 않는다', () => {
  const [withImage, without, nulled] = wiki([card('a', { imageId: 'image 1' }), card('b'), card('c', { imageId: null })]).docs
  expect(withImage.cardImage).toBe('/api/v1/public/works/work-1/world-card-images/image%201?upto=3')
  expect(Object.keys(without)).not.toContain('cardImage')
  expect(Object.keys(nulled)).not.toContain('cardImage')
  // 작품 id도 주소 한 조각으로 인코딩하고, 기준 회차는 서버가 적용한 값을 그대로 쓴다.
  expect(wiki([card('a', { imageId: 'i' })], [], { workId: 'w/1', upto: 12 }).docs[0].cardImage).toBe('/api/v1/public/works/w%2F1/world-card-images/i?upto=12')
})

it('관계는 양 끝 문서에서 연결하고 같은 상대·라벨도 관계별로 보존하며 자기 참조는 뺀다', () => {
  const { docs } = wiki([card('a'), card('b'), card('c')], [
    relation('a', 'b', '스승'), relation('b', 'a', '스승'), relation('b', 'a', '경쟁'), relation('c', 'a'), relation('c', 'c', '자기'),
  ])
  const links = Object.fromEntries(docs.map((d) => [d.id, d.links?.map(({ to, k }) => ({ to, k }))]))
  expect(links).toEqual({
    a: [{ to: 'b', k: '스승' }, { to: 'b', k: '스승' }, { to: 'b', k: '경쟁' }, { to: 'c', k: '' }],
    b: [{ to: 'a', k: '스승' }, { to: 'a', k: '스승' }, { to: 'a', k: '경쟁' }],
    c: [{ to: 'a', k: '' }],
  })
})

it('「동일 인물」 관계는 다른 이름 문서에서는 sourceFirst, 본체 문서에서는 반대로 분류 그대로 연결한다', () => {
  const [mask, body] = wiki([card('mask'), card('body')], [{ id: 'i', sourceCardId: 'mask', targetCardId: 'body', label: '동일 인물', category: 'identity', direction: 'directed', polarity: 'asserted' }]).docs
  expect(mask.links![0]).toMatchObject({ to: 'body', relation: { category: 'identity', direction: 'directed', sourceFirst: true } })
  expect(body.links![0]).toMatchObject({ to: 'mask', relation: { category: 'identity', direction: 'directed', sourceFirst: false } })
})
