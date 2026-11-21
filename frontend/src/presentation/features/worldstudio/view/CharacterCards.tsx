import '@xyflow/react/dist/style.css'
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ViewportPortal, getViewportForBounds, useReactFlow, type AriaLabelConfig, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type EdgeTypes, type OnNodesChange } from '@xyflow/react'
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { presentationPortrait } from '../../../../app/presentationPortraits'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'
import { labelAngle, ringLayout } from '../viewmodel/characterMap'
import { mapEndpoint, type MapNode, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'

/** `onPick`은 카드 본문을 눌렀을 때(드래그 없이) 부르고, 없으면 `onSelect`를 부른다. 관계 편집은 본문 누르기를 관계 연결에 쓰고 '정보 편집' 버튼만 `onSelect`로 남긴다. */
type Actions = { busy: boolean; selectedRelations: string[]; targetSource: string | null; readOnly?: boolean; onSelect: (id: string) => void; onConnect: (id: string) => void; onRelation: (id: string) => void; onPick?: (id: string) => void }
type Point = { x: number; y: number }
type CardData = { n: MapNode; selected: boolean; target: boolean; dim: boolean }
type FlowCard = Node<CardData, 'card'>
/** 간선 한 개를 그리는 값: 카드 가장자리에서 가장자리까지의 곡선(`d`), 라벨 자리(`lx`·`ly`)와 눕는 각도(`deg`), 이름·색. 좌표는 캔버스 좌표다. */
type RelationData = { relationId?: string; d: string; lx: number; ly: number; deg: number; color: string; active: boolean; dashed: boolean; arrow: boolean; label: string; name: string; title: string }
type FlowRelation = Edge<RelationData, 'relation'>
type Graph = { editing: Actions; marker: string; setHot: (key: string) => void; setFocusCard: (id: string) => void }

/** 카드 크기는 늘 같다(화면에 맞추는 축소는 캔버스의 확대·축소가 맡는다). 격자 배치의 카드 사이 간격은 144px다. */
const CARD_W = 200, CARD_H = 150, GAP = 144
/** 화면 맞춤: 가장자리에 12% 여백, 카드 글자가 읽히도록 원래 크기(1배)까지만 키우고 전체 보기는 0.15배까지 줄인다. 처음·중심 변경(`Fit`)과 컨트롤의 화면 맞춤 버튼이 같은 값을 쓴다. */
const FIT = { padding: '12%', minZoom: 0.15, maxZoom: 1 } as const // React Flow 13의 숫자 padding은 픽셀이라 비율은 문자열('%')로 쓴다
/** React Flow의 영어 컨트롤 이름을 한국어로 바꾼다. */
const ARIA: Partial<AriaLabelConfig> = { 'controls.ariaLabel': '관계도 조작', 'controls.zoomIn.ariaLabel': '확대', 'controls.zoomOut.ariaLabel': '축소', 'controls.fitView.ariaLabel': '화면에 맞추기' }

/**
 * 핸들 자리를 처음부터 알려 준다(서버 렌더링용 값): 부모가 다시 그릴 때마다 노드 객체가 새로 만들어지는데, 이 값이 없으면 그때마다 React Flow가 잰 핸들 자리를 잃어 간선이 사라지고 첫 그림에도 선이 없다.
 * 실제 핸들은 카드 안의 숨은 `Handle` 둘이고 선은 카드 가장자리에서 가장자리로 직접 그린다. 노드의 측정값(`measured`)도 처음부터 준다: 렌더마다 새로 만드는 노드가 측정값이 없으면 React Flow가 '노드가 아직 초기화되지 않았다'고 보아 컨트롤의 화면 맞춤 버튼(`fitView`)을 큐에 쌓아 두기만 한다.
 * 그 대신 처음·중심 변경 때의 맞춤은 React Flow의 `fitView` 속성이 아니라 `Fit`이 직접 계산한다(속성에 맡기면 상자 크기를 알기 전에 0×0으로 맞춰 잘못된 배율로 시작한다).
 */
const HANDLES = [{ type: 'target', position: Position.Top, x: CARD_W / 2, y: 0 }, { type: 'source', position: Position.Top, x: CARD_W / 2, y: 0 }] satisfies Node['handles']

/** 간선 래퍼에 이름을 달지 않는다는 표시. 런타임은 null이면 aria-label을 달지 않지만(기본은 영어 'Edge from … to …') 13.0.2의 타입은 string만 받는다. */
const NO_ARIA_LABEL = null as unknown as undefined

const GraphContext = createContext<Graph>({ editing: undefined as unknown as Actions, marker: '', setHot: () => {}, setFocusCard: () => {} })

function CardNode({ data, positionAbsoluteX, positionAbsoluteY }: NodeProps<FlowCard>) {
  const { editing, setFocusCard } = useContext(GraphContext)
  const { getZoom, setCenter } = useReactFlow()
  const { n, selected, target, dim } = data
  const portrait = presentationPortrait(n.name)
  // 키보드 초점이 간 카드가 캔버스 밖이면 그 카드가 가운데 오게 옮긴다(React Flow는 카드 안 버튼의 초점을 따라가지 않는다). 배율은 그대로다.
  const reveal = (card: HTMLElement) => {
    const view = card.closest('.react-flow')?.getBoundingClientRect(), box = card.getBoundingClientRect()
    if (view && (box.left < view.left || box.right > view.right || box.top < view.top || box.bottom > view.bottom)) void setCenter(positionAbsoluteX + CARD_W / 2, positionAbsoluteY + CARD_H / 2, { zoom: getZoom() })
  }
  return (
    <>
      {/* 간선을 이으려면 React Flow가 노드마다 핸들을 알아야 한다. 선은 카드 가장자리에서 가장자리로 직접 그리므로 핸들은 보이지도 눌리지도 않는다. */}
      <Handle type="target" position={Position.Top} isConnectable={false} className="relationship-handle" aria-hidden="true" />
      <Handle type="source" position={Position.Top} isConnectable={false} className="relationship-handle" aria-hidden="true" />
      <div className={'relationship-character-card' + (selected ? ' selected' : '') + (target ? ' target' : '') + (dim ? ' dim' : '')} onFocus={(e) => { setFocusCard(n.id); reveal(e.currentTarget) }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusCard('') }}>
        <h4 title={n.name}>{n.type && <i className="relationship-kind" style={{ background: CARD_COLORS[CARD_KIND[n.type]] }} aria-hidden="true" />}{portrait && <img src={portrait} alt="" width={36} height={36} />}{n.name}</h4>
        <p title={n.text}>{n.text || '소개를 입력할 수 있어요.'}</p>
        {/* nodrag·nopan: 버튼을 누르는 손짓이 카드 끌기·캔버스 이동으로 먹히지 않게 한다. */}
        <div className="nodrag nopan">
          <button type="button" className="btn sm" aria-label={`${n.name} ${editing.readOnly ? '상세 보기' : '정보 편집'}`} disabled={editing.busy || !!editing.targetSource} onClick={() => editing.onSelect(n.id)}>{editing.readOnly ? '상세 보기' : '정보 편집'}</button>
          {!editing.readOnly && (editing.targetSource
            ? <button type="button" className="btn pri sm" aria-label={`${n.name} 상대 선택`} disabled={editing.busy || n.id === editing.targetSource || n.unnamed} onClick={() => editing.onSelect(n.id)}>상대 선택</button>
            : <button type="button" className="btn sm" aria-label={`${n.name} 관계 연결`} disabled={editing.busy || n.unnamed} onClick={() => editing.onConnect(n.id)}>관계 연결</button>)}
        </div>
      </div>
    </>
  )
}

function RelationLine({ id, data }: EdgeProps<FlowRelation>) {
  const { editing, marker, setHot } = useContext(GraphContext)
  if (!data) return null
  return (
    <g>
      <path d={data.d} fill="none" stroke={data.color} strokeWidth={data.active ? 3 : 2} strokeDasharray={data.dashed ? '6 4' : undefined} markerEnd={data.arrow ? `url(#${marker})` : undefined} />
      <path d={data.d} className="relationship-edge-hit" fill="none" stroke="transparent" strokeWidth={16} role="button" tabIndex={-1} aria-label={data.name} onClick={() => { if (data.relationId && !editing.busy) editing.onRelation(data.relationId) }} onMouseEnter={() => setHot(id)} onMouseLeave={() => setHot('')} onFocus={() => setHot(id)} onBlur={() => setHot('')}><title>{data.title}</title></path>
    </g>
  )
}

/** React Flow는 nodeTypes·edgeTypes가 렌더마다 새 객체면 노드를 다시 만든다: 모듈 상수로 둔다. */
const nodeTypes = { card: CardNode } satisfies NodeTypes
const edgeTypes = { relation: RelationLine } satisfies EdgeTypes

/**
 * 화면 맞춤: 처음과 중심·이웃 구성이 바뀔 때(`k`) 모든 카드가 상자 안에 들어오게 뷰포트를 정한다. 이미 아는 카드 경계와 상자 크기로 직접 계산한다.
 * 끌어 옮긴 카드·확대·이동은 `k`가 같으면 건드리지 않는다. 컨트롤의 화면 맞춤 버튼은 같은 값(`FIT`)으로 React Flow가 한다.
 */
function Fit({ k, nodes, host }: { k: string; nodes: FlowCard[]; host: RefObject<HTMLDivElement | null> }) {
  const { setViewport } = useReactFlow()
  const latest = useRef(nodes)
  latest.current = nodes
  useEffect(() => {
    const el = host.current
    if (!el || !latest.current.length) return
    const xs = latest.current.map((n) => n.position.x), ys = latest.current.map((n) => n.position.y)
    const x = Math.min(...xs), y = Math.min(...ys), bounds = { x, y, width: Math.max(...xs) + CARD_W - x, height: Math.max(...ys) + CARD_H - y } // 카드 경계(위치 + 고정 크기)
    void setViewport(getViewportForBounds(bounds, el.clientWidth, el.clientHeight, FIT.minZoom, FIT.maxZoom, FIT.padding))
  }, [k, setViewport, host])
  return null
}
const finite = (p?: Point): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)

/**
 * 카드 그래프(React Flow 캔버스, `@xyflow/react`는 이 파일에서만 쓴다). 점 격자 배경 위에서 휠·핀치로 확대·축소하고 빈 곳을 끌어 옮기며 카드를 끌 수 있고(끈 위치는 화면 상태일 뿐 저장하지 않는다), 왼쪽 아래 컨트롤이 확대·축소·화면 맞춤이다.
 * `center`(중심 카드 id)가 있으면 그 카드를 가운데에 두고 이웃(`vm.graph.nodes`의 나머지)을 둘레 원 위에 놓는다(`ringLayout`, 선이 서로 교차하지 않는 별 모양). 없으면 모든 카드를 격자에 깐다. 처음과 중심·이웃이 바뀔 때 화면을 맞춘다(`Fit`).
 * 관계선 라벨(`<text>`)은 중심 보기에서는 중심 카드에 닿는 선에, 전체 보기에서는 마우스를 올리거나 초점을 둔 선(키보드는 카드 버튼에 초점이 있는 카드에 닿는 선)에만 그리고, 나머지 선은 `<title>` 툴팁·누르는 영역의 이름으로만 읽힌다(겹친 선의 라벨이 서로 가리지 않게).
 * 층: 간선(React Flow 간선 층) < 카드 < 라벨(뷰포트 포털의 SVG). 캔버스 높이는 CSS가 정하고, 이 컴포넌트는 캔버스 위쪽의 문서 위치만 `--rf-top`으로 알린다(관계도 보기가 '화면 높이 − 위쪽'을 채운다).
 */
export default function CharacterCards({ vm, editing, center }: { vm: ReturnType<typeof useWorldMapViewModel>; editing: Actions; center?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [manual, setManual] = useState(() => new Map<string, Point>())
  // 중심 카드가 바뀌면 끌어 둔 위치를 버린다(다른 중심의 둘레에 옛 위치가 남지 않게).
  const [shownCenter, setShownCenter] = useState(center)
  if (shownCenter !== center) { setShownCenter(center); setManual(new Map()) }
  const marker = useId().replaceAll(':', '')
  const [hot, setHot] = useState(''), [focusCard, setFocusCard] = useState('') // hot: 마우스를 올리거나 초점을 둔 선, focusCard: 키보드 초점이 있는 카드(그 카드에 닿는 선의 라벨도 보인다)
  const nodesIn = vm.graph.nodes
  const others = nodesIn.filter((n) => n.id !== center)
  // 배치는 중심 카드·이웃 수가 바뀔 때만 다시 만든다(부모가 다시 그릴 때마다 nodes가 새 배열이라 그 배열을 열쇠로 쓰면 매번 새로 만들어진다).
  const ring = useMemo(() => (center ? ringLayout(others.length, CARD_W, CARD_H) : null), [center, others.length])
  const columns = Math.max(1, Math.min(nodesIn.length || 1, Math.ceil(Math.sqrt(nodesIn.length * 1.5))))
  const layout = ring
    ? new Map<string, Point>([[center!, ring.center], ...others.map((n, i) => [n.id, ring.ring[i]] as [string, Point])])
    : new Map(nodesIn.map((n, i) => [n.id, { x: (i % columns) * (CARD_W + GAP), y: Math.floor(i / columns) * (CARD_H + GAP) }]))
  const at = (id: string) => { const p = manual.get(id) ?? layout.get(id); return finite(p) ? p : undefined } // NaN·무한대 좌표는 그리지 않는다
  // 캔버스 상자가 숨겨져(display:none) 크기가 0이면 React Flow를 그리지 않는다: 0×0 상자에서는 경고(#004)가 반복되고 화면 맞춤이 NaN 좌표를 만든다(관계 편집기는 다른 보기·카드 편집 화면에서도 숨은 채 마운트돼 있다).
  // 보이면 다시 그려 처음처럼 화면을 맞춘다. 끌어 둔 카드 위치·호버 상태는 이 컴포넌트의 상태라 그대로다.
  const [sized, setSized] = useState(false)
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const update = () => setSized(el.clientWidth > 0 && el.clientHeight > 0)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // 캔버스 위쪽의 문서 위치(도구줄 높이)를 CSS에 알린다: 렌더마다·창 크기가 바뀔 때 다시 잰다.
  const measure = useRef(() => {})
  measure.current = () => { const el = host.current; if (el) el.style.setProperty('--rf-top', `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`) }
  useLayoutEffect(() => { measure.current() })
  useEffect(() => { const run = () => measure.current(); window.addEventListener('resize', run); return () => window.removeEventListener('resize', run) }, [])

  const names = new Map(nodesIn.map((n) => [n.id, n.name])), title = (id: string) => names.get(id) ?? '인물'
  const subject = nodesIn.some((n) => n.kind !== '인물') ? '설정' : '인물'
  const canDrag = !editing.busy && !editing.targetSource // 상대를 고르는 중에는 카드를 끌지 않고 누르기만 받는다
  const nodes: FlowCard[] = nodesIn.map((n) => {
    const selected = vm.selected?.id === n.id
    return {
      id: n.id, type: 'card', position: at(n.id) ?? { x: 0, y: 0 }, width: CARD_W, height: CARD_H, measured: { width: CARD_W, height: CARD_H }, handles: HANDLES, draggable: canDrag,
      ariaRole: 'group', ariaLabel: `${n.name} ${n.kind} 카드`, domAttributes: { 'aria-current': selected || undefined, 'aria-roledescription': '카드' },
      data: { n, selected, target: !!editing.targetSource && n.id !== editing.targetSource, dim: !vm.visible.has(n.id) },
    }
  })
  const edges: FlowRelation[] = vm.graph.links.flatMap((l, i) => {
    const source = mapEndpoint(l.source), target = mapEndpoint(l.target), a = at(source), b = at(target)
    if (!a || !b) return []
    const ax = a.x + CARD_W / 2, ay = a.y + CARD_H / 2, bx = b.x + CARD_W / 2, by = b.y + CARD_H / 2, dx = bx - ax, dy = by - ay
    const factor = Math.min((CARD_W / 2 + 10) / Math.max(1, Math.abs(dx)), (CARD_H / 2 + 10) / Math.max(1, Math.abs(dy)))
    const sx = ax + dx * factor, sy = ay + dy * factor, tx = bx - dx * factor, ty = by - dy * factor, c = l.curve ?? 0
    const qx = (ax + bx) / 2 + dy * c, qy = (ay + by) / 2 - dx * c, active = !!l.id && editing.selectedRelations.includes(l.id), key = l.id ?? String(i)
    return [{
      id: key, type: 'relation', source, target,
      ariaRole: 'none', ariaLabel: NO_ARIA_LABEL, // 기본 래퍼는 role=img(자식을 읽지 못한다)·영어 이름(카드 id)이다: 이름 있는 선 버튼이 이 안에 있으니 래퍼는 의미를 갖지 않는다
      data: {
        relationId: l.id, d: `M ${sx} ${sy} Q ${qx} ${qy} ${tx} ${ty}`, active, dashed: !!l.emotion, arrow: !l.symmetric, label: l.label,
        lx: (sx + 2 * qx + tx) / 4, ly: (sy + 2 * qy + ty) / 4, deg: Math.round(labelAngle(tx - sx, ty - sy) * 10) / 10, // 곡선의 가운데(t=½)와 선 방향
        color: active ? 'var(--edge-active,var(--pri))' : l.emotion ? 'var(--edge-emotion,var(--acc-ink))' : 'var(--edge,var(--pri-ink))',
        name: `${editing.readOnly ? '관계선 보기' : '관계선 편집'}: ${title(source)} · ${title(target)} · ${l.fullLabel ?? l.label}`, title: l.fullLabel ?? l.label,
      },
    }]
  })
  // 라벨: 중심 보기는 중심 카드에 닿는 선(이 보기의 모든 선)에만, 전체 보기는 마우스를 올리거나 초점을 둔 선 하나에만 그린다(수십 개의 라벨이 서로 겹치지 않게). 선 자체는 툴팁·이름으로 늘 읽힌다.
  const labelled = edges.filter((e) => (center ? e.source === center || e.target === center : hot === e.id || e.source === focusCard || e.target === focusCard))
  // 카드 본문을 누를 때: 카드 안 버튼의 누르기는 제외한다. 끌고 놓은 직후의 click은 React Flow가 막아 여기까지 오지 않는다(`preventNextClick`).
  const onNodeClick = (event: ReactMouseEvent, node: Node) => {
    if (editing.busy || (event.target instanceof Element && event.target.closest('button'))) return
    ;(editing.onPick ?? editing.onSelect)(node.id)
  }
  // 13.0.2의 변경 묶음은 배열이 아니라 `NodeChangeset`이다. 쓰는 것은 끌어 옮긴 위치(position)뿐이다.
  const onNodesChange: OnNodesChange<FlowCard> = (changes) => {
    const moved = changes.getByType('position').flatMap((c) => (finite(c.position) ? [[c.id, c.position] as [string, Point]] : []))
    if (moved.length) setManual((old) => { const next = new Map(old); for (const [id, position] of moved) next.set(id, position); return next })
  }
  const context = { editing, marker, setHot, setFocusCard }
  return (
    <div ref={host} className="relationship-flow" role="group" aria-label={`${subject} 카드 그래프`}>
      <svg className="relationship-marker-defs" aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge,var(--pri-ink))" /></marker></defs></svg>
      {sized && <GraphContext.Provider value={context}>
        {/* 카드는 선택·삭제·키보드 이동·초점이 없다(카드 안 버튼이 키보드 길이다). disableKeyboardA11y는 노드의 영어 키보드 안내(aria-describedby)를 걷고, panActivationKeyCode·deleteKeyCode의 null은 Space·Backspace를 document에서 가로채는 기본 단축키를 꺼서 Space로 페이지를 내릴 수 있게 한다. */}
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeClick={onNodeClick}
          nodeDragThreshold={4} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false} disableKeyboardA11y deleteKeyCode={null} panActivationKeyCode={null} zoomOnDoubleClick={false}
          minZoom={FIT.minZoom} maxZoom={1.75} forceColorMode="dark" ariaLabelConfig={ARIA}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />
          <Controls showInteractive={false} fitViewOptions={FIT} />
          <Fit k={`${center ?? ''}|${nodesIn.map((n) => n.id).join(',')}`} nodes={nodes} host={host} />
          <ViewportPortal>
            <svg className="relationship-card-labels" aria-hidden="true">
              {labelled.map((e) => {
                const d = e.data!
                return <text key={e.id} x={d.lx} y={d.ly - 7} textAnchor="middle" fill={d.color} className="relationship-edge-label" transform={`rotate(${d.deg} ${d.lx} ${d.ly})`}>{d.label}</text>
              })}
            </svg>
          </ViewportPortal>
        </ReactFlow>
      </GraphContext.Provider>}
    </div>
  )
}
