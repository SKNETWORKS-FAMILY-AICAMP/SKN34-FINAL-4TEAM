import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'
import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { SettingItem, StudioSetting } from '../../../../domain/entities/studioWorld'
import { CARD_KIND, type BoardEntry } from '../../../shared/worldBoard'
import { plainCardText } from '../../../shared/cardSections'

/*
 * 설정 카드 단계의 게시판: 편집 중인 설정(`StudioSetting[]`)을 공개 설정집과 같은 게시판 원자료(`BoardEntry`)로 바꾼다.
 * 관계·메모·분류 확인 항목은 카드가 아니라 게시판에 오르지 않는다(기존 설정·관계 목록이 따로 보인다).
 */

/** 카드가 아닌 기존 항목(관계·메모·분류 확인 …)의 옛 의미 이름 */
export const kinds: Record<SettingItem['kind'], string> = { entity: '대상', fact: '설정', rule: '규칙', constraint: '제약', claim: '인물의 주장', relation: '관계', undetermined: '미정', event: '과거 사건', note: '메모' }
/** 카드 유형 이름(인물·장소 …). 카드가 아닌 기존 항목은 옛 의미 이름이다. */
export const labelOf = (setting: StudioSetting) => cardTypes.find((t) => t.id === cardTypeOf(setting.item))?.label ?? kinds[setting.item.kind]

/** 게시판에 오르는 카드의 유형(없으면 카드가 아니다). */
const boardType = (s: StudioSetting) => cardTypes.find((t) => t.id === cardTypeOf(s.item))

/** `via`는 인물 관계 설정(relation)으로 이어졌는지, 관련 설정·사건 순서(link)로 이어졌는지다. */
type SettingLink = { id: string; title: string; label: string; via: 'relation' | 'link' }

/**
 * 카드 한 장에 이어진 카드: 관계 설정(주체·대상 어느 쪽이든)이 먼저, 이어서 관련 설정(`relatedIds`, 어느 쪽이 썼든)과 사건 순서(`afterId`)다. 쓴 순서를 지킨다.
 * 없는 카드·자기 자신·카드가 아닌 항목은 버린다. 같은 카드가 관계 둘로 이어지면 두 번 나온다(관계마다 이름이 다르다).
 */
export function settingLinks(settings: StudioSetting[], id: string): SettingLink[] {
  const cards = new Map(settings.filter(boardType).map((s) => [s.item.id, s.item]))
  if (!cards.has(id)) return []
  const links: SettingLink[] = []
  const add = (other: string | null, label: string, via: SettingLink['via']) => {
    const item = other && other !== id ? cards.get(other) : undefined
    if (item && !links.some((l) => l.id === item.id && l.label === label)) links.push({ id: item.id, title: item.title || '이름 없는 설정', label, via })
  }
  for (const { item } of settings) {
    if (item.kind !== 'relation') continue
    if (item.subjectId === id) add(item.targetId, relationLabel(item), 'relation')
    else if (item.targetId === id) add(item.subjectId, relationLabel(item), 'relation')
  }
  for (const item of cards.values()) {
    if (item.id === id) {
      for (const other of item.relatedIds) add(other, '관련 설정', 'link')
      add(item.afterId, '앞선 사건', 'link')
    } else {
      if (item.relatedIds.includes(id)) add(item.id, '관련 설정', 'link')
      if (item.afterId === id) add(item.id, '이후 사건', 'link')
    }
  }
  return links
}

/** 요약 열의 한 줄 글. 본문에서 기호를 벗기는 일은 카드마다 한 번만 하고, 본문이 바뀐 카드만 다시 한다(초안을 고칠 때마다 모든 카드를 다시 벗기지 않는다). */
const summaries = new WeakMap<SettingItem, { source: string; plain: string }>()
function summaryOf(item: SettingItem) {
  let cached = summaries.get(item)
  if (cached?.source !== item.text) summaries.set(item, cached = { source: item.text, plain: plainCardText(item.text) })
  return cached.plain
}

/**
 * 설정 카드를 게시판 줄의 원자료로. 연결 수는 이어진 카드 수, 제목 옆 수는 인물이면 관계로 이어진 상대 수이고 그 밖은 연결 수다(공개 설정집과 같은 규칙).
 * 이어진 카드는 `settingLinks`와 같은 규칙(관계의 양 끝, 관련 설정·사건 순서의 양쪽)으로 세되, 카드마다 `settingLinks`를 부르지 않고 한 번 훑어 모은다:
 * 입력할 때마다 다시 계산하는 값이라 카드 수의 제곱으로 걸리면(1,000장에 150ms쯤) 타자가 밀린다.
 */
export function settingBoardEntries(settings: StudioSetting[]): BoardEntry[] {
  const cards = settings.flatMap((s) => {
    const type = boardType(s)
    return type ? [{ item: s.item, type }] : []
  })
  const linked = new Map(cards.map(({ item }) => [item.id, new Set<string>()]))
  const related = new Map(cards.map(({ item }) => [item.id, new Set<string>()]))
  /** 두 카드를 서로 잇는다. 없는 카드·자기 자신·카드가 아닌 항목은 버린다. */
  const link = (a: string | null, b: string | null, into: Map<string, Set<string>>[]) => {
    if (!a || !b || a === b || !linked.has(a) || !linked.has(b)) return
    for (const sets of into) {
      sets.get(a)?.add(b)
      sets.get(b)?.add(a)
    }
  }
  for (const { item } of settings) if (item.kind === 'relation') link(item.subjectId, item.targetId, [linked, related])
  for (const { item } of cards) {
    for (const other of item.relatedIds) link(item.id, other, [linked])
    link(item.id, item.afterId, [linked])
  }
  return cards.map(({ item, type }) => {
    const connections = linked.get(item.id)?.size ?? 0
    const kind = CARD_KIND[type.id]
    return { cardId: item.id, title: item.title || '이름 없는 설정', text: summaryOf(item), type: type.label, kind, connections, badge: kind === '인물' ? related.get(item.id)?.size ?? 0 : connections }
  })
}
