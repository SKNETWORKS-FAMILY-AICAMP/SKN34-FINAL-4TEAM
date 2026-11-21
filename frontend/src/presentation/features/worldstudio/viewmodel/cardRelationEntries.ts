import { cardTypeOf, cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import type { RelationEntry } from '../../../shared/cardRelations'
import { CARD_KIND } from '../../../shared/worldBoard'
import { settingLinks } from './settingBoard'

/**
 * 작가 편집 화면의 카드(`cardId`)에 이어진 것을 카드별 관계도의 입력으로: 이 카드를 끝점으로 하는 승인된 관계(이름 하나, 시작 회차 `fromEpisode`, 모르면 null)와
 * 관련 설정·앞뒤 사건·본문 링크로 이어진 카드(관계가 아니라 이름이 그 연결 이름이고 회차 모름, `link:` id)다. 없는 카드·카드가 아닌 항목은 뺀다.
 */
export function cardRelationEntries(settings: readonly StudioSetting[], cardId: string): RelationEntry[] {
  const cards = new Map(settings.filter((s) => cardTypes.some((t) => t.id === cardTypeOf(s.item))).map((s) => [s.item.id, s.item]))
  const kindOf = (id: string) => CARD_KIND[cardTypeOf(cards.get(id)!) as CardType]
  const rows: RelationEntry[] = []
  for (const { item } of settings) {
    if (item.kind !== 'relation' || item.decision !== 'approved') continue
    const other = item.subjectId === cardId ? item.targetId : item.targetId === cardId ? item.subjectId : null
    if (other && other !== cardId && cards.has(other)) rows.push({ id: item.id, otherId: other, otherTitle: cards.get(other)!.title || '이름 없는 설정', otherKind: kindOf(other), steps: [{ name: relationLabel(item), episode: item.fromEpisode ?? null }] })
  }
  for (const link of settingLinks([...settings], cardId)) if (link.via === 'link') rows.push({ id: 'link:' + link.id + ':' + link.label, otherId: link.id, otherTitle: link.title, otherKind: kindOf(link.id), steps: [{ name: link.label, episode: null }] })
  return rows
}
