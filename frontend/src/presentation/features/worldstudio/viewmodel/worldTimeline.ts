import { cardTypeOf, type CardType } from '../../../../domain/entities/studioCards'
import { relationShortName } from '../../../../domain/entities/studioRelations'
import { cardRevealEpisode, type SettingItem, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { KNOWLEDGE_KINDS } from './relationView'

/*
 * 시간선(순수): 저장한 설정(`vm.saved`)의 사건을 회차 열로 묶는다. 새 요청 없이 이미 있는 데이터만 쓴다.
 * 회차 정렬 우선순위: ①사건 카드의 공개 회차(`cardRevealEpisode`) ②그 사건에 걸린 관계의 가장 이른 시작 회차(`fromEpisode`) ③둘 다 없으면 afterId로 이은 앞선 사건의 회차(같은 열 아래)
 * ④그래도 없으면 마지막 '시점 미정' 열에 기존 순서로. 같은 회차의 사건은 같은 열에 위아래로 놓이고 열 안에서는 사슬이 앞선 사건이 위, 같으면 기존 순서다.
 */

/** 한 쪽(구간)에 그리는 회차 열 수: 사건이 1,600개여도 DOM이 수백 개 이하로 유지된다. */
export const PAGE_COLUMNS = 20
/** 한 열에 사건이 이보다 많으면 '사건 N' 한 줄로 접는다(눌러서 펼친다). */
export const COLUMN_CAP = 6

export type Participant = { id: string; title: string; type: CardType }
export type TimelineEvent = { item: SettingItem; episode: number | null; participants: Participant[] }
export type TimelineColumn = { key: string; episode: number | null; label: string; events: TimelineEvent[] }
export type Timeline = { columns: TimelineColumn[]; arrows: { from: string; to: string }[] }

export function buildTimeline(settings: readonly StudioSetting[]): Timeline {
  const rows = settings.filter((s) => s.item.kind === 'event' && s.item.decision === 'approved')
  if (!rows.length) return { columns: [], arrows: [] }
  const byId = new Map(rows.map((s) => [s.item.id, s]))
  const cards = new Map(settings.filter((s) => s.item.kind !== 'relation').map((s) => [s.item.id, s]))
  const touching = new Map<string, StudioSetting[]>() // 사건 id → 그 사건에 걸린 승인된 관계(어느 끝이든)
  for (const s of settings) {
    if (s.item.kind !== 'relation' || s.item.decision !== 'approved') continue
    for (const id of new Set([s.item.subjectId, s.item.targetId])) if (id && byId.has(id)) (touching.get(id) ?? touching.set(id, []).get(id)!).push(s)
  }
  const path = new Set<string>(), episodes = new Map<string, number | null>(), depths = new Map<string, number>()
  const episodeOf = (id: string): number | null => {
    if (episodes.has(id)) return episodes.get(id)!
    if (path.has(id)) return null // 순환
    path.add(id)
    const s = byId.get(id)!, from = (touching.get(id) ?? []).flatMap((r) => (r.item.fromEpisode ? [r.item.fromEpisode] : []))
    const after = s.item.afterId
    const value = cardRevealEpisode(s) ?? (from.length ? Math.min(...from) : after && byId.has(after) ? episodeOf(after) : null)
    path.delete(id)
    episodes.set(id, value)
    return value
  }
  const depthOf = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!
    if (path.has(id)) return 0
    path.add(id)
    const after = byId.get(id)!.item.afterId
    const value = after && byId.has(after) ? 1 + depthOf(after) : 0
    path.delete(id)
    depths.set(id, value)
    return value
  }
  const titleOf = (id: string | null) => (id ? cards.get(id)?.item.title : undefined)
  const participantsOf = (id: string): Participant[] => {
    const seen = new Set<string>(), out: Participant[] = []
    for (const r of touching.get(id) ?? []) {
      if (KNOWLEDGE_KINDS.includes(relationShortName(r.item, titleOf))) continue // 정보 관계는 참여가 아니다(서버에서 읽은 관계의 이름은 label이다)
      const other = r.item.subjectId === id ? r.item.targetId : r.item.subjectId, found = other ? cards.get(other) : undefined
      const type = found && cardTypeOf(found.item)
      if (found && (type === 'character' || type === 'location') && !seen.has(found.item.id)) { seen.add(found.item.id); out.push({ id: found.item.id, title: found.item.title, type }) }
    }
    return out
  }
  const index = new Map(rows.map((s, i) => [s.item.id, i]))
  const groups = new Map<number | null, TimelineEvent[]>()
  for (const s of rows) {
    const episode = episodeOf(s.item.id), group = groups.get(episode) ?? groups.set(episode, []).get(episode)!
    group.push({ item: s.item, episode, participants: participantsOf(s.item.id) })
  }
  const columns = [...groups.keys()].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)).map((episode): TimelineColumn => ({
    key: episode === null ? 'none' : String(episode), episode, label: episode === null ? '시점 미정' : episode + '화',
    events: groups.get(episode)!.sort((a, b) => depthOf(a.item.id) - depthOf(b.item.id) || index.get(a.item.id)! - index.get(b.item.id)!),
  }))
  return { columns, arrows: rows.flatMap((s) => (s.item.afterId && byId.has(s.item.afterId) ? [{ from: s.item.afterId, to: s.item.id }] : [])) }
}
