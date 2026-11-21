import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { stripCardLinks } from '../../../../domain/entities/cardLinks'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import { useElementSize } from '../../../shared/useElementSize'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'
import { COLUMN_CAP, PAGE_COLUMNS, buildTimeline, type Timeline } from '../viewmodel/worldTimeline'
import './world-timeline.css'

/** 회차 열의 폭, 축(눈금 글자 아래 선)의 y, 첫 행 점 중심의 y, 행 간격. world-timeline.css의 .world-timeline-event(폭 120·점 14·간격 8)와 함께 바꾼다. */
const COL_W = 132, AXIS_Y = 24, DOT_Y = 64, ROW_H = 92
const EVENT_COLOR = CARD_COLORS[CARD_KIND.event]

/**
 * 시간선(가로 시간축): 저장한 설정의 사건을 회차 열로 묶어 왼쪽→오른쪽으로 놓고(같은 회차는 같은 열 위아래), 축 위에 회차 눈금, 사건 점은 한 줄 시간선으로 잇고 afterId는 굵은 화살표를 더한다.
 * 한 쪽에 회차 열 20개만 그리고(이전·다음 구간), 한 열에 사건이 6개를 넘으면 '사건 N' 한 줄로 접어 사건 1,600개에도 DOM이 수백 개 이하다. 정렬 규칙은 `buildTimeline`이다.
 * 가로로 스크롤하고(휠은 가로로 바꾸지 않는다) 방향키(←→↑↓)로 사건을 오가며 Enter가 고른다(aria-pressed). 고른 사건의 설명은 넓으면 오른쪽 패널, 좁으면 아래에 놓인다(CSS 컨테이너 쿼리).
 * 시간축 SVG는 상자 크기를 재서 그리고(`useElementSize`: 사이드바 접기·창 크기로 바뀌면 다시) 크기가 0이면 그리지 않는다.
 */
export function WorldTimeline({ settings, onOpenCard }: { settings: readonly StudioSetting[]; onOpenCard?: (id: string) => void }) {
  const timeline = useMemo(() => buildTimeline(settings), [settings])
  if (!timeline.columns.length) return <p className="world-empty">아직 확정한 과거 사건이 없어요.</p>
  return <TimelineBoard timeline={timeline} settings={settings} onOpenCard={onOpenCard} />
}

function TimelineBoard({ timeline, settings, onOpenCard }: { timeline: Timeline; settings: readonly StudioSetting[]; onOpenCard?: (id: string) => void }) {
  const all = useMemo(() => timeline.columns.flatMap((c) => c.events), [timeline])
  const titleOf = useMemo(() => new Map(settings.map((s) => [s.item.id, s.item.title])), [settings])
  const [selected, setSelected] = useState<string | null>(null), [page, setPage] = useState(0), [stopId, setStopId] = useState<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(timeline.columns[0].events.length > COLUMN_CAP ? [timeline.columns[0].key] : [])) // 첫 사건이 든 열은 펼친 채 시작
  const scroll = useRef<HTMLDivElement>(null), size = useElementSize(scroll)
  const current = all.find((e) => e.item.id === selected) ?? all[0]
  const pages = Math.ceil(timeline.columns.length / PAGE_COLUMNS), at = Math.min(page, pages - 1)
  const columns = timeline.columns.slice(at * PAGE_COLUMNS, (at + 1) * PAGE_COLUMNS)

  // 놓을 것: 열마다 (접을 수 있는 열이면 맨 위 '사건 N' 줄 + 펼쳤을 때 사건들) 행 번호를 정한다.
  const dots = new Map<string, { x: number; y: number }>(), points: { x: number; y: number }[] = [], stops: string[] = []
  let rows = 1
  const placed = columns.map((col, c) => {
    const heavy = col.events.length > COLUMN_CAP, shown = !heavy || open.has(col.key), x = c * COL_W + COL_W / 2
    const events = shown ? col.events.map((event, i) => { const y = DOT_Y + (i + (heavy ? 1 : 0)) * ROW_H; dots.set(event.item.id, { x, y }); points.push({ x, y }); stops.push(event.item.id); return { event, y } }) : []
    if (heavy) { points.unshift(...[]); stops.splice(stops.length - events.length, 0, 'more:' + col.key) }
    if (heavy && !shown) points.push({ x, y: DOT_Y })
    rows = Math.max(rows, events.length + (heavy ? 1 : 0))
    return { col, heavy, shown, x, events }
  })
  const active = stopId && stops.includes(stopId) ? stopId : stops.includes(current.item.id) ? current.item.id : stops[0]
  const width = columns.length * COL_W, height = DOT_Y + rows * ROW_H + 8
  const label = columns.length ? columns[0].label + '–' + columns[columns.length - 1].label : ''
  const toggle = (key: string) => setOpen((old) => { const next = new Set(old); if (!next.delete(key)) next.add(key); return next })
  const move = (e: KeyboardEvent<HTMLElement>) => { // ←→↑↓: 다음·이전 사건(열 순서, 같은 열은 위에서 아래로)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0, target = e.target as HTMLElement
    if (!step || !target.dataset.stop) return
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-stop]')], next = all[all.indexOf(target) + step]
    if (next) { e.preventDefault(); next.focus() }
  }
  const related = [...current.participants.map((p) => [p.id, p.title] as const), ...current.item.relatedIds.filter((id) => !current.participants.some((p) => p.id === id)).map((id) => [id, titleOf.get(id) ?? '알 수 없는 항목'] as const)]
  const drawn = timeline.arrows.filter((a) => dots.has(a.from) && dots.has(a.to))
  const svgWidth = Math.max(width, size.w)

  return (
    <div className="world-timeline">
      {pages > 1 && (
        <nav className="world-timeline-pager" aria-label="회차 구간">
          <button type="button" className="btn sm" disabled={at === 0} onClick={() => setPage(at - 1)}>이전 구간</button>
          <span>{label} ({at + 1}/{pages})</span>
          <button type="button" className="btn sm" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>다음 구간</button>
        </nav>
      )}
      <div className="world-timeline-body">
        <div ref={scroll} className="world-timeline-scroll" role="region" aria-label="사건 시간선" tabIndex={0} onKeyDown={move}>
          <div className="world-timeline-board" style={{ width, height }}>
            {size.w > 0 && (
              <svg width={svgWidth} height={height} aria-hidden="true">
                <defs><marker id="timeline-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
                <line x1={0} y1={AXIS_Y} x2={svgWidth} y2={AXIS_Y} stroke="currentColor" strokeWidth={1} />
                {placed.map(({ col, x }) => <g key={col.key}><line x1={x} y1={AXIS_Y - 4} x2={x} y2={AXIS_Y + 4} stroke="currentColor" strokeWidth={1} /><text x={x} y={AXIS_Y - 9} textAnchor="middle">{col.label}</text></g>)}
                {points.length > 1 && <polyline points={points.map((p) => p.x + ',' + p.y).join(' ')} fill="none" stroke="currentColor" strokeWidth={1.5} />}
                {drawn.map((a) => { const from = dots.get(a.from)!, to = dots.get(a.to)!; return <path key={a.from + '>' + a.to} d={'M ' + from.x + ' ' + from.y + ' Q ' + ((from.x + to.x) / 2 + (from.x === to.x ? 30 : 0)) + ' ' + ((from.y + to.y) / 2 + 36) + ' ' + to.x + ' ' + to.y} fill="none" stroke="currentColor" strokeWidth={2.5} markerEnd="url(#timeline-arrow)" /> })}
              </svg>
            )}
            {placed.flatMap(({ col, heavy, shown, x, events }) => [
              ...(heavy ? [<button key={'more:' + col.key} type="button" data-stop className="world-timeline-more" style={{ left: x - 52, top: DOT_Y - 13 }} tabIndex={active === 'more:' + col.key ? 0 : -1} aria-expanded={shown} onFocus={() => setStopId('more:' + col.key)} onClick={() => toggle(col.key)}>사건 {col.events.length}</button>] : []),
              ...events.map(({ event, y }) => {
                const id = event.item.id, picked = current.item.id === id
                return (
                  <button key={id} type="button" data-stop className="world-timeline-event" style={{ left: x - 60, top: y - 7 }} title={(event.item.timeText ? event.item.timeText + ' · ' : '') + event.item.title} tabIndex={active === id ? 0 : -1} aria-pressed={picked} onFocus={() => setStopId(id)} onClick={() => setSelected(id)}>
                    <span className="world-timeline-dot" style={picked ? undefined : { background: EVENT_COLOR }} />
                    <strong>{event.item.title}</strong>
                    <span className="world-timeline-time">{event.item.timeText}</span>
                  </button>
                )
              }),
            ])}
          </div>
        </div>
        <div className="world-timeline-description" aria-live="polite">
          <span className="chip">{current.item.timeText || '시점 미지정'}</span>{current.episode !== null && <span className="chip">{current.episode}화</span>}
          <h4>{current.item.title}</h4>
          <p className="world-prose">{stripCardLinks(current.item.text)}</p>
          {current.item.afterId && <p className="small muted">앞선 사건 · {titleOf.get(current.item.afterId) ?? '알 수 없는 항목'}</p>}
          <div className="world-timeline-related">{related.map(([id, title]) => (onOpenCard ? <button type="button" className="chip" key={id} onClick={() => onOpenCard(id)}>{title}</button> : <span className="chip" key={id}>{title}</span>))}</div>
        </div>
      </div>
    </div>
  )
}
