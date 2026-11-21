import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Go } from './Go'
import { PageControls } from './PageControls'
import { atEpisode, episodeTabs, groupNeighbors, layoutOf, type Neighbor, type RelationEntry } from './cardRelations'
import { pageItems } from './pageItems'
import { CARD_COLORS, type CardKind } from './worldBoard'
import './cardRelations.css'

/** 탭에 바로 보이는 회차 수: 넘치면 나머지는 더보기 선택으로 고른다. */
const TAB_MAX = 6
/** 그림 상자와 둘레의 반지름(가로·세로). 물리 없이 고정 좌표다. */
const W = 560, H = 340, RX = 205, RY = 120
const short = (text: string, max: number) => (Array.from(text).length > max ? Array.from(text).slice(0, max).join('') + '…' : text)
const label = (n: Neighbor) => n.name + (n.more ? ' 외 ' + n.more : '')

/**
 * 카드별 관계도('이 카드는 이렇게 연관됩니다', 옵시디언 로컬 그래프처럼): 가운데 카드 하나와 사건이 아닌 이웃을 유형별로 모아 둘레에 둔 고정 좌표 SVG다(물리 없음, 최대 16개, 넘치면 '외 N개'는 아래 목록에).
 * 같은 상대의 관계는 선 하나이고 선 위에 가장 늦은 회차의 관계 이름(+외 N)이, 이웃이나 선에 올리면 이력(`경계(1화) → 보호(3화)`)이 말풍선(title)으로 보인다. 선은 1px다.
 * 사건은 둘레에 두지 않고 '함께한 사건 N'(회차순, 접힘 목록)에 모은다. 위의 탭 줄(`전체 · 1화 · 3화 …`)은 관계가 생기거나 바뀌는 회차이고 N화 탭은 그 시점까지의 관계만 보인다(화면 필터,
 * 6개를 넘으면 더보기). 작가 화면은 가운데 카드의 공개 회차(`revealEpisode`)보다 앞선 탭에 '독자에게 숨김'을 단다. 그림은 `aria-hidden`이고 아래 간단 목록(상대 — 관계 이름 · N화부터)이 키보드·낭독기 경로다.
 * 이웃을 누르면 그 카드로 간다: 공개 화면은 주소(`hrefOf`, 링크), 작가 화면은 편집 화면 열기(`onOpen`, 버튼). 이웃이 없으면 한 줄 안내와 `emptyAction`(작가 화면의 관계 추가)이다.
 */
export function CardRelationMap({ center, badge, entries, revealEpisode, hrefOf, onOpen, emptyAction }: {
  center: { id: string; title: string; kind: CardKind }; badge?: string; entries: readonly RelationEntry[]; revealEpisode?: number | null
  hrefOf?: (id: string) => string; onOpen?: (id: string) => void; emptyAction?: ReactNode
}) {
  const id = useId(), navigate = useNavigate()
  const [tab, setTab] = useState<number | null>(null), [page, setPage] = useState(0)
  const episodes = episodeTabs(entries), choice = tab !== null && episodes.includes(tab) ? tab : null
  const { ring, rest, people, events } = layoutOf(groupNeighbors(atEpisode(entries, choice)))
  const open = (to: string) => (onOpen ? onOpen(to) : hrefOf && navigate(hrefOf(to)))
  const link = (n: Neighbor) => (hrefOf ? <Go to={hrefOf(n.id)}>{n.title}</Go> : <button type="button" className="card-relmap-link" onClick={() => onOpen?.(n.id)}>{n.title}</button>)
  const paged = pageItems(people, page, 50), pagedEvents = pageItems(events, 0, 200)
  const items = [null, ...episodes.slice(0, TAB_MAX)], more = episodes.slice(TAB_MAX)
  const pick = (value: number | null) => { setTab(value); setPage(0) }
  const move = (e: KeyboardEvent<HTMLElement>) => { // 탭 줄: ←→·Home·End로 탭을 옮긴다
    const at = items.findIndex((v) => v === choice), next = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
    if (next < 0 || next >= items.length || at < 0) return
    e.preventDefault()
    pick(items[next])
    document.getElementById(id + '-tab-' + (items[next] ?? 'all'))?.focus()
  }
  const hidden = (n: number) => revealEpisode != null && n < revealEpisode
  if (!entries.length) return <section className="card-relmap" aria-label="카드별 관계도"><p className="small muted card-relmap-empty">아직 연결된 설정이 없어요 {emptyAction}</p></section>
  return (
    <section className="card-relmap" aria-label="카드별 관계도">
      {episodes.length > 0 && (
        <div className="card-relmap-tabs" role="tablist" aria-label="공개 회차" onKeyDown={move}>
          {items.map((value) => (
            <button key={value ?? 'all'} id={id + '-tab-' + (value ?? 'all')} type="button" role="tab" aria-selected={choice === value} tabIndex={choice === value ? 0 : -1} title={value !== null && hidden(value) ? '아직 독자에게 숨김' : undefined} onClick={() => pick(value)}>
              {value === null ? '전체' : value + '화'}{value !== null && hidden(value) && <small> 숨김</small>}
            </button>
          ))}
          {more.length > 0 && (
            <select aria-label="더 많은 회차" value={choice !== null && more.includes(choice) ? choice : ''} onChange={(e) => pick(e.target.value ? Number(e.target.value) : choice)}>
              <option value="">더보기</option>
              {more.map((n) => <option key={n} value={n}>{n}화{hidden(n) ? ' (독자에게 숨김)' : ''}</option>)}
            </select>
          )}
        </div>
      )}
      <svg className="card-relmap-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
        {ring.map((n, i) => {
          const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length, x = W / 2 + RX * Math.cos(angle), y = H / 2 + RY * Math.sin(angle), side = Math.cos(angle)
          return (
            <g key={n.id} className="card-relmap-node" onClick={() => open(n.id)}>
              <title>{n.title + ' — ' + (n.history || label(n))}</title>
              <line x1={W / 2} y1={H / 2} x2={x} y2={y} />
              <text className="card-relmap-edge" x={(W / 2 + x) / 2} y={(H / 2 + y) / 2} textAnchor="middle">{short(label(n), 10)}</text>
              <circle cx={x} cy={y} r={9} fill={CARD_COLORS[n.kind]} />
              <text x={x + (side > 0.3 ? 14 : side < -0.3 ? -14 : 0)} y={y + (Math.abs(side) <= 0.3 ? (Math.sin(angle) > 0 ? 26 : -16) : 4)} textAnchor={side > 0.3 ? 'start' : side < -0.3 ? 'end' : 'middle'}>{short(n.title, 9)}</text>
            </g>
          )
        })}
        <circle cx={W / 2} cy={H / 2} r={20} fill={CARD_COLORS[center.kind]} />
        <text className="card-relmap-center" x={W / 2} y={H / 2 + 38} textAnchor="middle">{short(center.title, 12)}</text>
        {badge && <text className="card-relmap-badge" x={W / 2} y={H / 2 + 54} textAnchor="middle">{badge}</text>}
      </svg>
      {ring.length === 0 && <p className="small muted card-relmap-empty">{events.length ? '이 시점에는 사건 말고 연결된 설정이 없어요' : '이 시점에는 연결된 설정이 없어요'}</p>}
      {rest > 0 && <p className="small muted">외 {rest}개는 아래 목록에서 볼 수 있어요</p>}
      {people.length > 0 && (
        <>
          <ul className="card-relmap-list" aria-label="관계 목록">
            {paged.items.map((n) => <li key={n.id}>{link(n)} — {label(n)}{n.first !== null && ' · ' + n.first + '화부터'}{n.history && <small className="muted"> {n.history}</small>}</li>)}
          </ul>
          <PageControls page={paged.page} pages={paged.pages} onPage={setPage} />
        </>
      )}
      {events.length > 0 && (
        <details className="card-relmap-events">
          <summary>함께한 사건 {events.length}</summary>
          <ul>{pagedEvents.items.map((n) => <li key={n.id}>{link(n)} — {label(n)}{n.first !== null && ' · ' + n.first + '화'}</li>)}</ul>
        </details>
      )}
    </section>
  )
}
