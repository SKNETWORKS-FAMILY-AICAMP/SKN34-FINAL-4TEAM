import type { RelationEntry } from '../../shared/cardRelations'
import { relationName } from '../../shared/relationParagraph'
import type { CardPage } from './worldDetail'

/**
 * 공개 카드 페이지(`CardPage`)의 관계를 카드별 관계도의 입력으로: 이 카드에 문단으로 보이는 관계(`relations`)와 이 카드를 가리키는 단방향 관계(`backlinks` 중 관계 id가 있는 것)다.
 * 관계의 이름 이력(`history`, 서버가 기준 회차까지만 줌)이 있으면 그 이력이고 없으면 현재 이름 하나(회차 모름)다. 본문 링크로 가리킨 카드(관계 id 없음)는 관계가 아니라 뺀다.
 */
export function publicCardEntries(page: CardPage): RelationEntry[] {
  const entry = (r: CardPage['backlinks'][number]): RelationEntry => ({
    id: r.relationId!, otherId: r.cardId, otherTitle: r.title, otherKind: r.kind,
    steps: r.history?.length ? r.history.map(({ episode, label }) => ({ name: relationName(r.category, label), episode })) : [{ name: relationName(r.category, r.label ?? '') || '관계', episode: null }],
  })
  return [...page.relations, ...page.backlinks.filter((r) => r.relationId)].map(entry)
}
