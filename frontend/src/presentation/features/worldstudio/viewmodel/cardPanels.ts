/*
 * 설정 카드 편집 화면 왼쪽의 활동 막대(VS Code식 아이콘 줄)의 순수 규칙: 가운데 본문을 바꾸는 화면(pane) 다섯 개와 아이콘 위 배지.
 * 고른 화면은 주소의 `?card=<id>&pane=<화면>`이 정본이라(새로고침·공유·게시판 상태 칩이 같은 주소로 연다) 따로 기억하지 않는다. 기본은 문서(`pane`이 없다).
 */
export const CARD_PANES = [
  { id: 'overview', label: '개요' },
  { id: 'doc', label: '문서' },
  { id: 'relations', label: '관계' },
  { id: 'versions', label: '버전' },
  { id: 'order', label: '공개 순서' },
] as const
export type CardPane = (typeof CARD_PANES)[number]['id']
/** 처음 보이는 화면(주소에 `pane`이 없을 때): 문서 편집기. */
export const DEFAULT_PANE: CardPane = 'doc'

/** 주소의 `pane` 값을 화면으로: 없거나 모르는 값이면 문서다. */
export const parseCardPane = (value: string | null): CardPane => CARD_PANES.find((p) => p.id === value)?.id ?? DEFAULT_PANE

/** 아이콘 위 배지: `text`는 보이는 글(빈 글이면 점), `label`은 읽는 이름 뒤에 붙는 말이다. */
export type PaneBadge = { text: string; label: string }

/** 관계는 수, 버전은 확정 버전 수(저장하지 않은 변경이 있으면 점), 공개 순서는 문제 수다. 0이면 배지가 없다. 99를 넘으면 글자는 99+다. */
export function paneBadges({ relations, versions, dirty, issues }: { relations: number; versions: number; dirty: boolean; issues: number }): Partial<Record<CardPane, PaneBadge>> {
  const count = (n: number, unit: string): PaneBadge => ({ text: n > 99 ? '99+' : String(n), label: n + unit })
  return {
    ...(relations > 0 && { relations: count(relations, '개') }),
    ...(dirty ? { versions: { text: '', label: '저장 안 됨' } } : versions > 0 && { versions: count(versions, '개') }),
    ...(issues > 0 && { order: count(issues, '건') }),
  }
}

/** 아이콘 버튼의 읽는 이름: 화면 이름 뒤에 배지의 말을 붙인다. */
export const tabName = (label: string, badge?: PaneBadge) => (badge ? label + ' ' + badge.label : label)
