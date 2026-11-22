import { stripCardLinks } from '../../../../domain/entities/cardLinks'
import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'
import { relationShortName } from '../../../../domain/entities/studioRelations'
import { cardRevealEpisode, type StudioWorld } from '../../../../domain/entities/studioWorld'

/*
 * 세계관 내보내기(순수): 저장한 세계관(`vm.saved`: 카드·관계·관계별 시작 회차·공개 회차)을 JSON·Markdown 글로 바꾼다. 브라우저 안에서 파일로 내려받을 뿐 서버를 부르지 않는다.
 * 다시 가져오기는 하지 않는다(JSON은 가져오기용 계약이 아니라 보관용이다. ponytail: 가져오기가 필요하면 스키마 버전을 보고 읽는 쪽을 따로 만든다).
 */

/** JSON 형식의 버전: 모양이 바뀌면 올린다. */
export const EXPORT_SCHEMA_VERSION = 1

const NO_TITLE = '이름 없는 설정'

/** 내보낼 카드(관계 행이 아닌 설정 카드)와 양 끝 카드가 있는 승인된 관계. */
function parts(world: StudioWorld) {
  const cards = world.settings.filter((s) => cardTypes.some((t) => t.id === cardTypeOf(s.item)))
  const ids = new Set(cards.map((s) => s.item.id)), titles = new Map(cards.map((s) => [s.item.id, s.item.title]))
  const relations = world.settings.filter((s) => s.item.kind === 'relation' && s.item.decision === 'approved' && ids.has(s.item.subjectId ?? '') && ids.has(s.item.targetId ?? ''))
  // 관계 이름: 서버에서 읽은 자유 관계는 항목 이름(label)이고 본문(text)은 설명이다(relationShortName).
  const nameOf = (item: StudioWorld['settings'][number]['item']) => relationShortName(item, (id) => (id ? titles.get(id) : undefined))
  return { cards, relations, nameOf }
}
/** JSON: 카드(id·유형·제목·별칭·태그·본문·공개 회차)와 관계(출발·도착·이름·설명·시작 회차), 스키마 버전 하나. 회차가 없으면(작가 전용·시작 회차 미정) null이다. */
export function worldToJson(world: StudioWorld) {
  const { cards, relations, nameOf } = parts(world)
  return JSON.stringify({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    world: { id: world.id, name: world.name, description: world.description },
    cards: cards.map((s) => ({ id: s.item.id, type: cardTypeOf(s.item), title: s.item.title, aliases: s.aliases ?? [], tags: s.tags, text: s.item.text, revealFromEpisode: cardRevealEpisode(s) ?? null })),
    relations: relations.map((s) => { const name = nameOf(s.item), text = s.item.text.trim(); return { id: s.item.id, source: s.item.subjectId, target: s.item.targetId, name, description: text && s.item.text !== s.item.title && text !== name ? s.item.text : '', fromEpisode: s.item.fromEpisode ?? null } }),
  }, null, 2)
}

/**
 * Markdown: 세계관 제목·설명 → 카드 유형별 `## 인물` 아래 카드마다 `### 이름`·본문(카드 링크는 글자만)과 관계 줄 `- 상대 — 관계명 (N화부터)`.
 * 그 카드로 들어오는 관계는 `- ← 상대 — 관계명`으로 같이 쓴다. 카드가 없는 유형은 쓰지 않는다.
 */
export function worldToMarkdown(world: StudioWorld) {
  const { cards, relations, nameOf } = parts(world)
  const title = new Map(cards.map((s) => [s.item.id, s.item.title || NO_TITLE]))
  const line = (arrow: string, other: string | null, item: (typeof relations)[number]['item']) => '- ' + arrow + title.get(other ?? '') + ' — ' + nameOf(item) + (item.fromEpisode ? ' (' + item.fromEpisode + '화부터)' : '')
  const out = ['# ' + (world.name || '이름 없는 세계관'), '', ...(world.description ? [world.description, ''] : [''])]
  for (const type of cardTypes) {
    const group = cards.filter((s) => cardTypeOf(s.item) === type.id)
    if (!group.length) continue
    out.push('## ' + type.label, '')
    for (const card of group) {
      out.push('### ' + (card.item.title || NO_TITLE), '')
      const body = stripCardLinks(card.item.text).trim()
      if (body) out.push(body, '')
      const mine = [
        ...relations.filter((s) => s.item.subjectId === card.item.id).map((s) => line('', s.item.targetId, s.item)),
        ...relations.filter((s) => s.item.targetId === card.item.id).map((s) => line('← ', s.item.subjectId, s.item)),
      ]
      if (mine.length) out.push(...mine, '')
    }
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

/** 파일 이름: `세계관이름-YYYYMMDD.확장자`. 파일 이름에 못 쓰는 글자는 _로 바꾸고 이름이 비면 '세계관'이다. */
export function exportFileName(name: string, extension: 'json' | 'md', day = new Date()) {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim() || '세계관'
  const date = day.getFullYear() + String(day.getMonth() + 1).padStart(2, '0') + String(day.getDate()).padStart(2, '0')
  return safe + '-' + date + '.' + extension
}
