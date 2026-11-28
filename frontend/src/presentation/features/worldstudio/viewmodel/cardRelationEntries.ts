import { cardTypeOf, isCard } from '../../../../domain/entities/studioCards'
import { relationShortName } from '../../../../domain/entities/studioRelations'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import type { RelationEntry } from '../../../shared/cardRelations'
import { kindOf as groupOf } from '../../../shared/worldBoard'
import { settingLinks } from '../../../shared/settingBoard'

/**
 * 작가 편집 화면의 카드(`cardId`)에 이어진 것을 카드별 관계도의 입력으로: 이 카드를 끝점으로 하는 승인된 관계(짧은 이름 `relationShortName` — 서버에서 읽은 자유 관계는 label이고 본문이 이름이 되지 않는다 — 과
 * 본문 `body`(이름·항목 이름과 다른 설명 문장, 목록을 펼칠 때만 보인다), 시작 회차 `fromEpisode`, 모르면 null)와
 * 관련 설정·앞뒤 사건·본문 링크로 이어진 카드(관계가 아니라 이름이 그 연결 이름이고 회차 모름, `link:` id)다. 없는 카드·카드가 아닌 항목은 뺀다.
 */
export function cardRelationEntries(settings: readonly StudioSetting[], cardId: string): RelationEntry[] {
  const cards = new Map(settings.filter((s) => isCard(s.item)).map((s) => [s.item.id, s.item]))
  const kindOf = (id: string) => groupOf(cardTypeOf(cards.get(id)!))
  const titleOf = (id: string | null) => (id ? cards.get(id)?.title : undefined)
  const rows: RelationEntry[] = []
  for (const { item } of settings) {
    if (item.kind !== 'relation' || item.decision !== 'approved') continue
    const other = item.subjectId === cardId ? item.targetId : item.targetId === cardId ? item.subjectId : null
    if (!other || other === cardId || !cards.has(other)) continue
    const name = relationShortName(item, titleOf), text = item.text.trim() // 자동으로 지은 설명(항목 이름과 같다)과 이름 자체는 본문이 아니다
    rows.push({ id: item.id, otherId: other, otherTitle: cards.get(other)!.title || '이름 없는 설정', otherKind: kindOf(other), steps: [{ name, episode: item.fromEpisode ?? null, ...(text && item.text !== item.title && text !== name ? { body: text } : {}) }] })
  }
  for (const link of settingLinks([...settings], cardId)) if (link.via === 'link') rows.push({ id: 'link:' + link.id + ':' + link.label, otherId: link.id, otherTitle: link.title, otherKind: kindOf(link.id), steps: [{ name: link.label, episode: null }] })
  return rows
}
