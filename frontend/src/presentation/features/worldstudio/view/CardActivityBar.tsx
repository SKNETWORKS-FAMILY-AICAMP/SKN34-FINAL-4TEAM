import type { KeyboardEvent, ReactNode } from 'react'
import { StrokeIcon } from '../../../shared/icons'
import { CARD_PANES, tabName, type CardPane, type PaneBadge } from '../viewmodel/cardPanels'

/** 활동 막대 아이콘(24 격자 선 아이콘): 개요=카드, 문서=쪽, 관계=그래프, 버전=분기(소스 컨트롤), 공개 순서=경고, 설정 카드 목록=목록. */
const ICONS: Record<CardPane | 'list', ReactNode> = {
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  overview: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10.5 13h6M10.5 17h6" /></>,
  relations: <><circle cx="6" cy="6.5" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.5 7l7 .8M7.2 8.7l3.6 6.8M16.8 10.3l-3.5 5.6" /></>,
  versions: <><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 7.2v9.6M18 10.2c0 4.2-3.4 6.2-12 5.8" /></>,
  order: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
}

/**
 * 설정 카드 편집 화면 왼쪽의 활동 막대(VS Code처럼 세로 아이콘 줄, 아이콘만으로는 뜻을 알 수 없어 버튼마다 아이콘 아래 짧은 글자 라벨이 늘 보인다: 카드 목록·개요·문서·관계·버전·공개 순서). 맨 위 목록 버튼은 설정 카드 목록 패널을 펴고 접는 토글이고(`aria-expanded`, 가운데 화면은 그대로),
 * 구분선 아래 아이콘 다섯은 가운데 본문 전체를 그 화면으로 바꾸는 탭이다(`role="tablist"`: 개요·문서·관계·버전·공개 순서, 한 번에 하나, `aria-controls`는 가운데 `tabpanel`).
 * 탭의 읽는 이름(aria-label)에 배지 수가 들어가고(`관계 12개`) 툴팁(title)은 화면 이름이다. 읽는 이름이 따로 있으므로 화면의 글자 라벨은 `aria-hidden`이라 겹쳐 읽지 않고, 읽는 이름은 화면 라벨을 포함한다(목록 토글 `설정 카드 목록` ⊃ `카드 목록`, label in name). ↑↓←→로 초점이 이웃 탭으로 옮겨 가고(처음·끝에서 이어진다, Home·End) 고르는 것은 Enter·Space(버튼의 누르기)다.
 * Tab 자리는 고른 탭 하나다. 좁은 화면은 CSS가 가로 줄로 바꾼다(`aria-orientation`은 마크업 그대로).
 */
export function CardActivityBar({ pane, paneId, badges, onPane, listOpen, listId, onList }: {
  pane: CardPane; paneId: string; badges: Partial<Record<CardPane, PaneBadge>>; onPane: (pane: CardPane) => void
  listOpen: boolean; listId: string; onList: () => void
}) {
  const move = (e: KeyboardEvent<HTMLElement>) => {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')], at = tabs.indexOf(e.target as HTMLElement)
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (at < 0 || next === null) return
    e.preventDefault()
    tabs[(next + tabs.length) % tabs.length].focus()
  }
  return (
    <div className="world-activity">
      <button type="button" className="world-activity-tab" aria-expanded={listOpen} aria-controls={listOpen ? listId : undefined} aria-label="설정 카드 목록" title="설정 카드 목록" onClick={onList}>
        <span className="world-activity-icon"><StrokeIcon size={20}>{ICONS.list}</StrokeIcon></span>
        <span className="world-activity-label" aria-hidden="true">카드 목록</span>
      </button>
      <span className="world-activity-sep" aria-hidden="true" />
      <div role="tablist" aria-orientation="vertical" aria-label="카드 화면" className="world-activity-tabs" onKeyDown={move}>
        {CARD_PANES.map(({ id, label }) => {
          const badge = badges[id], on = pane === id
          return (
            <button key={id} type="button" role="tab" id={`${paneId}-tab-${id}`} className="world-activity-tab" aria-selected={on} aria-controls={paneId} aria-label={tabName(label, badge)} title={label} tabIndex={on ? 0 : -1} onClick={() => onPane(id)}>
              <span className="world-activity-icon">
                <StrokeIcon size={20}>{ICONS[id]}</StrokeIcon>
                {badge && <span className={'world-activity-badge' + (badge.text ? '' : ' dot') + (id === 'order' ? ' warn' : '')} aria-hidden="true">{badge.text}</span>}
              </span>
              <span className="world-activity-label" aria-hidden="true">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
