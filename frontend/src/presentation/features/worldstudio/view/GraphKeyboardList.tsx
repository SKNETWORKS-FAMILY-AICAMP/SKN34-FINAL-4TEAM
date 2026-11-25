import { useState, type FocusEvent, type KeyboardEvent } from 'react'
import { cardTypes } from '../../../../domain/entities/studioCards'
import { endId, relationTitle, type GLink, type GNode } from '../viewmodel/graphModel'
import { centerOf, isMenuKey } from './menuKey'

const isDelete = (e: KeyboardEvent) => e.key === 'Delete' || e.key === 'Backspace'
/** 목록 안의 같은 종류 버튼(`selector`) 사이에서 `from`의 이웃으로 초점을 옮긴다(`to`: 다음 1, 이전 −1, 처음 'first', 끝 'last'). */
function move(from: HTMLElement, selector: string, to: 1 | -1 | 'first' | 'last') {
  const group = [...(from.closest('section')?.querySelectorAll<HTMLElement>(selector) ?? [])], at = group.indexOf(from)
  group[to === 'first' ? 0 : to === 'last' ? group.length - 1 : Math.min(group.length - 1, Math.max(0, at + to))]?.focus()
}

/**
 * 키보드로 관계도 조작(캔버스는 키보드로 닿지 않으므로 같은 일을 하는 목록): 설정마다 버튼 하나이고 Tab 한 번에 들어와(`tabIndex` 로빙) 방향키·Home·End로 오가며 Enter는 정보 편집, Delete는 삭제, 메뉴 키·Shift+F10은 캔버스의 오른쪽 클릭과 같은 메뉴를 연다.
 * 초점이 간 설정은 캔버스가 마우스를 올린 것처럼 강조하고, 그 설정의 관계 목록('가람 ↔ 나래 · 친구', 방향이 이름에 담긴다)이 아래에 펼쳐진다: Tab으로 들어가 Enter는 관계 편집, Delete는 관계 삭제, 메뉴 키는 선 메뉴이고 초점이 간 관계의 선은 강조되며 관계 이름이 보인다.
 * 목록은 접힌 상태를 따른다(접힌 위성은 없고 허브 버튼에 접힌 위성 수가 있다: 메뉴 키로 열리는 메뉴에서 펼친다).
 * 화면에서는 초점이 있을 때만 보인다(CSS: `.relationship-keys:not(:focus-within)`은 시각적으로만 숨긴다).
 */
export function GraphKeyboardList({ nodes, links, names, selected, folded, onFocusNode, onFocusLink, onEdit, onDelete, onEditRelation, onDeleteRelation, onMenu }: {
  nodes: readonly GNode[]; links: readonly GLink[]; names: (id: string) => string; selected: string; folded: ReadonlyMap<string, number>
  onFocusNode: (id: string) => void; onFocusLink: (id: string) => void
  onEdit: (id: string) => void; onDelete: (id: string) => void; onEditRelation: (relationId: string) => void; onDeleteRelation: (relationId: string) => void
  onMenu: (kind: 'node' | 'link', id: string, at: { x: number; y: number }) => void
}) {
  const [active, setActive] = useState('')
  const current = nodes.some((n) => n.id === active) ? active : nodes[0]?.id
  const nodeKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const go = (to: 1 | -1 | 'first' | 'last') => { e.preventDefault(); move(e.currentTarget, '[data-node-id]', to) }
    if (e.key === 'ArrowDown') go(1)
    else if (e.key === 'ArrowUp') go(-1)
    else if (e.key === 'Home') go('first')
    else if (e.key === 'End') go('last')
    else if (e.key === 'Enter') { e.preventDefault(); onEdit(id) }
    else if (isDelete(e)) { e.preventDefault(); onDelete(id) }
    else if (isMenuKey(e)) { e.preventDefault(); onMenu('node', id, centerOf(e.currentTarget)) }
  }
  const relationKey = (e: KeyboardEvent<HTMLButtonElement>, linkId: string, relationId: string) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(e.currentTarget, '[data-relation-id]', 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(e.currentTarget, '[data-relation-id]', -1) }
    else if (e.key === 'Enter') { e.preventDefault(); onEditRelation(relationId) }
    else if (isDelete(e)) { e.preventDefault(); onDeleteRelation(relationId) }
    else if (isMenuKey(e)) { e.preventDefault(); onMenu('link', linkId, centerOf(e.currentTarget)) }
  }
  // 설정 하나의 묶음(설정 버튼 + 그 관계 목록) 안에서 초점이 옮겨 다니는 동안은 강조를 유지하고, 묶음 밖으로 나가면 푼다.
  const focused = (e: FocusEvent<HTMLElement>, id: string) => {
    const target = e.target as HTMLElement
    setActive(id)
    onFocusNode(id)
    onFocusLink(target.dataset.linkId ?? '')
  }
  const blurred = (e: FocusEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    onFocusNode('')
    onFocusLink('')
  }
  return (
    <section className="relationship-keys" aria-label="키보드로 관계도 조작">
      <p className="small muted">↑↓ 설정 고르기 · Enter 정보 편집 · Delete 삭제 · 메뉴 키(Shift+F10) 메뉴 · Tab 관계 목록</p>
      <ul aria-label="설정 목록">
        {nodes.map((n) => {
          const kind = cardTypes.find((t) => t.id === n.type)?.label ?? (n.type ? '기타' : '설정')
          const mine = n.id === current ? links.filter((l) => endId(l.source) === n.id || endId(l.target) === n.id) : []
          return (
            <li key={n.id} onFocus={(e) => focused(e, n.id)} onBlur={blurred}>
              <button type="button" data-node-id={n.id} aria-current={n.id === selected || undefined} tabIndex={n.id === current ? 0 : -1} onKeyDown={(e) => nodeKey(e, n.id)} onClick={() => onEdit(n.id)}>{n.name} · {kind} · 관계 {n.degree}개{folded.has(n.id) ? ' · 접힌 위성 ' + folded.get(n.id) + '개' : ''}</button>
              {mine.length > 0 && (
                <ul aria-label={n.name + '의 관계'}>
                  {mine.flatMap((link) => link.relations.filter((r) => r.id).map((r) => (
                    <li key={r.id}>
                      <button type="button" data-relation-id={r.id} data-link-id={link.id} onKeyDown={(e) => relationKey(e, link.id, r.id!)} onClick={() => onEditRelation(r.id!)}>{relationTitle(r, names)}</button>
                    </li>
                  )))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
