import { cardTypes } from '../../../../domain/entities/studioCards'
import type { Doc, ReaderWorldCards, Wiki } from '../../../../domain/entities/wiki'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'

/**
 * 작품에 연결된 세계관(DEC-46)의 독자 공개 카드를 설정 위키(`PublicWikiArticle`)의 문서로 바꾼다. 서버가 기준 회차까지 공개한 카드와
 * 양 끝이 그 카드인 관계만 주므로 여기서는 거르지 않는다. 분류는 카드 유형(색은 공개 세계관과 같은 유형 묶음 색)이고 본문은 마크다운이며,
 * 정보 상자에는 별칭·태그·독자 공개 시작 회차가 들어간다. 관계는 양 끝 문서 모두에 상대 문서로 가는 연결로 붙는다
 * (자기 자신과의 관계는 빼고, 같은 상대·같은 라벨은 한 번만). 대표 이미지(`imageId`)가 있는 카드는 독자 공개 이미지 주소를 `cardImage`로 싣는다:
 * 서버가 카드를 고른 기준 회차(`upto`)를 그대로 붙여야 같은 카드의 이미지로 인정된다.
 */
export function worldCardWiki({ workId, upto, cards, relationships }: Pick<ReaderWorldCards, 'workId' | 'upto' | 'cards' | 'relationships'>): Wiki {
  const linksOf = (id: string) => {
    const links = relationships.flatMap((r) => (
      r.sourceCardId === r.targetCardId ? [] : r.sourceCardId === id ? [{ to: r.targetCardId, k: r.label }] : r.targetCardId === id ? [{ to: r.sourceCardId, k: r.label }] : []
    ))
    return links.filter((link, i) => links.findIndex((other) => other.to === link.to && other.k === link.k) === i)
  }
  const docs: Doc[] = cards.map((card) => ({
    id: card.id, cat: card.cardType, t: card.title, alias: card.aliases, tags: card.tags, at: {}, body: card.text, markdown: true, links: linksOf(card.id),
    ...(card.imageId && { cardImage: `/api/v1/public/works/${encodeURIComponent(workId)}/world-card-images/${encodeURIComponent(card.imageId)}?upto=${upto}` }),
    props: { ...(card.tags.length ? { 태그: card.tags.join(', ') } : {}), 공개: `${card.revealFromEpisode}화부터` },
  }))
  return { docs, cats: cardTypes.map(({ id, label }) => ({ id, n: label, c: CARD_COLORS[CARD_KIND[id]] })) }
}
