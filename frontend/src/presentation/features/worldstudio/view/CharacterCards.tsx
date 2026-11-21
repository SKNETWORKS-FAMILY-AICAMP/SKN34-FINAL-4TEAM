import '@xyflow/react/dist/style.css'
import { Background, BackgroundVariant, Controls, Handle, Panel, Position, ReactFlow, ReactFlowProvider, ViewportPortal, getViewportForBounds, useReactFlow, useReactFlowStoreApi, useViewportStore, type AriaLabelConfig, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type EdgeTypes, type OnNodesChange } from '@xyflow/react'
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { presentationPortrait } from '../../../../app/presentationPortraits'
import { cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'
import { labelAngle } from '../viewmodel/characterMap'
import { CARD_H, CARD_W, freeSpot, validConnection, type Point } from '../viewmodel/canvasLayout'
import { forceLayout } from '../viewmodel/forceLayout'
import { ZOOM_TO_NODE, degrees, dotDiameter, labelLimit, topDegreeIds, zoomLevel, type ZoomLevel } from '../viewmodel/zoomLevel'
import { mapEndpoint, type MapNode, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import { AddCardPanel } from './AddCardPanel'
import { RelationContextMenu, type MenuEntry } from './RelationContextMenu'

/**
 * 캔버스가 편집기에 거는 동작. 카드 본문을 누르면(`onPick`) 선택, 연결 모드(`targetSource`)에서는 상대 고르기다. `onMark`는 새로 놓은 카드를 부작용 없이 선택만 한다.
 * `onAdd`는 초안에 카드를 더하고 그 id를 돌려준다(처리 중이면 안 준다). 삭제(`onDeleteCard`·`onDeleteRelation`)는 확인을 거치는 쪽이 정한다. `deleteLock`은 카드 삭제를 막는 이유('' = 삭제할 수 있다).
 */
type Actions = {
  busy: boolean; selectedRelations: string[]; targetSource: string | null; deleteLock: string
  onPick: (id: string) => void; onSelect: (id: string) => void; onConnect: (id: string) => void; onPair: (source: string, target: string) => void
  onRelation: (id: string) => void; onDeleteCard: (id: string) => void; onDeleteRelation: (id: string) => void; onAdd: (type: CardType) => string | undefined; onMark: (id: string) => void
}
/** 카드 한 장을 그리는 값: 확대 단계(`level`)마다 모양이 다르다. `center`는 단계와 상관없는 카드 중심(캔버스 좌표), `diameter`는 점 지름, `named`는 멀리서도 이름을 붙이는 카드다. */
type CardData = { n: MapNode; selected: boolean; target: boolean; dim: boolean; level: ZoomLevel; diameter: number; named: boolean; center: Point }
type FlowCard = Node<CardData, 'card'>
/** 간선 한 개를 그리는 값: 카드 가장자리에서 가장자리까지의 곡선(`d`), 라벨 자리(`lx`·`ly`)와 눕는 각도(`deg`), 이름·색. 좌표는 캔버스 좌표다. */
type RelationData = { level: ZoomLevel; relationId?: string; d: string; lx: number; ly: number; deg: number; color: string; active: boolean; dashed: boolean; arrow: boolean; label: string; name: string; title: string; full: string }
type FlowRelation = Edge<RelationData, 'relation'>
/** 열린 오른쪽 클릭 메뉴: 빈 곳(`flow` = 누른 자리의 캔버스 좌표)·카드·선. 좌표 x·y는 화면 좌표다. */
type MenuState = { x: number; y: number } & ({ kind: 'pane'; flow: Point } | { kind: 'node'; id: string } | { kind: 'edge'; relationId: string })
type Graph = { editing: Actions; marker: string; setHot: (key: string) => void; setFocusCard: (id: string) => void; openMenu: (menu: MenuState) => void; reveal: (card: HTMLElement, center: Point) => void; pressed: MutableRefObject<boolean> }

/** 화면 맞춤: 가장자리에 12% 여백, 카드 글자가 읽히도록 원래 크기(1배)까지만 키우고 0.05배까지 줄인다(카드 수백 장이 한 화면에 들어온다). 처음·도구 막대·컨트롤의 화면 맞춤이 같은 값을 쓴다. */
const FIT = { padding: '12%', minZoom: 0.05, maxZoom: 1 } as const // React Flow 13의 숫자 padding은 픽셀이라 비율은 문자열('%')로 쓴다
/** 길게 누르기(터치)로 카드 메뉴를 여는 시간과 그 사이 허용하는 움직임(px). */
const LONG_PRESS_MS = 600, LONG_PRESS_MOVE = 10
/** React Flow의 영어 컨트롤 이름을 한국어로 바꾼다. */
const ARIA: Partial<AriaLabelConfig> = { 'controls.ariaLabel': '관계도 조작', 'controls.zoomIn.ariaLabel': '확대', 'controls.zoomOut.ariaLabel': '축소', 'controls.fitView.ariaLabel': '화면에 맞추기' }

/**
 * 핸들 자리를 처음부터 알려 준다(서버 렌더링용 값): 부모가 다시 그릴 때마다 노드 객체가 새로 만들어지는데, 이 값이 없으면 그때마다 React Flow가 잰 핸들 자리를 잃어 간선이 사라지고 첫 그림에도 선이 없다.
 * 실제 핸들은 카드 안의 `Handle` 둘이다: 왼쪽(target)·오른쪽(source) 점이 끌어 잇기의 출발·도착 자리이고 선은 카드 가장자리에서 가장자리로 직접 그린다.
 * `id: null`은 DOM에서 잰 값(이름 없는 핸들의 `data-handleid`가 null)과 같게 맞춘 것이다(어긋나면 끌어 잇기가 도착 점을 찾지 못한다).
 * 노드의 측정값(`measured`)도 처음부터 준다: 렌더마다 새로 만드는 노드가 측정값이 없으면 React Flow가 '노드가 아직 초기화되지 않았다'고 보아 컨트롤의 화면 맞춤 버튼(`fitView`)을 큐에 쌓아 두기만 한다.
 */
const HANDLES = [
  { id: null, type: 'target', position: Position.Left, x: -6, y: CARD_H / 2 - 6, width: 12, height: 12 },
  { id: null, type: 'source', position: Position.Right, x: CARD_W - 6, y: CARD_H / 2 - 6, width: 12, height: 12 },
] satisfies Node['handles']

/** 간선 래퍼에 이름을 달지 않는다는 표시. 런타임은 null이면 aria-label을 달지 않지만(기본은 영어 'Edge from … to …') 13.0.2의 타입은 string만 받는다. */
const NO_ARIA_LABEL = null as unknown as undefined

const GraphContext = createContext<Graph>({ editing: undefined as unknown as Actions, marker: '', setHot: () => {}, setFocusCard: () => {}, openMenu: () => {}, reveal: () => {}, pressed: { current: false } })

const isMenuKey = (e: ReactKeyboardEvent) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
const centerOf = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

function CardNode({ data }: NodeProps<FlowCard>) {
  const { editing, setFocusCard, openMenu, reveal, pressed } = useContext(GraphContext)
  const { n, selected, target, dim, level, named, center } = data
  const portrait = presentationPortrait(n.name)
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const cancelPress = () => { if (press.current) { window.clearTimeout(press.current.timer); press.current = null } }
  const connectable = !editing.busy && !n.unnamed && !editing.targetSource
  const state = (selected ? ' selected' : '') + (target ? ' target' : '') + (dim ? ' dim' : '')
  // 카드와 점이 함께 쓰는 초점·길게 누르기(터치는 길게 누르면 오른쪽 클릭 메뉴가 열린다: 손가락에는 오른쪽 클릭이 없다)
  const shared = {
    onFocus: (e: ReactFocusEvent<HTMLDivElement>) => { setFocusCard(n.id); reveal(e.currentTarget, center) },
    onBlur: (e: ReactFocusEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusCard('') },
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'touch') return
      cancelPress()
      const { clientX: x, clientY: y } = e
      press.current = { x, y, timer: window.setTimeout(() => { press.current = null; pressed.current = true; openMenu({ kind: 'node', id: n.id, x, y }) }, LONG_PRESS_MS) }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_MOVE) cancelPress() },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
  }
  // 왼쪽(target)·오른쪽(source) 점: 한 점에서 다른 카드로 끌어 놓으면 그 둘의 관계 작성이 열린다(자기 자신·이름 없는 카드는 막는다).
  // 끌어 잇기는 가까이(near)에서만 되지만 점 요소는 어느 단계에나 둔다: React Flow는 선을 그릴 때 양 끝 노드의 핸들을 요구해(없으면 선을 그리지 않는다), 멀리·중간에서는 숨기고 누르지 못하게만 한다(CSS).
  const ports = (
    <>
      <Handle type="target" position={Position.Left} isConnectable={level === 'near' && connectable} className="relationship-port" aria-hidden="true" />
      <Handle type="source" position={Position.Right} isConnectable={level === 'near' && connectable} className="relationship-port" aria-hidden="true" />
    </>
  )
  // 멀리(far)·중간(mid)에서는 카드 대신 유형 색의 점이다. 이름은 중간에서는 모두, 멀리서는 관계가 많은 몇 장과 고른 카드에만 붙는다. 카드 버튼은 가까이(near)에서만 있다.
  if (level !== 'near') {
    return (
      <>
        {ports}
        <div className={'relationship-dot' + state} style={{ background: n.type ? CARD_COLORS[CARD_KIND[n.type]] : 'var(--fixed-sub)' }} {...shared} />
        <span className={'relationship-dot-name' + (level === 'mid' || named || selected ? ' shown' : '')} aria-hidden="true">{n.name}</span>
      </>
    )
  }
  return (
    <>
      {ports}
      <div className={'relationship-character-card' + state} {...shared}>
        <h4 title={n.name}>{n.type && <i className="relationship-kind" style={{ background: CARD_COLORS[CARD_KIND[n.type]] }} aria-hidden="true" />}{portrait && <img src={portrait} alt="" width={36} height={36} />}{n.name}</h4>
        <p title={n.text}>{n.text || '소개를 입력할 수 있어요.'}</p>
        {/* nodrag·nopan: 버튼을 누르는 손짓이 카드 끌기·캔버스 이동으로 먹히지 않게 한다. */}
        <div className="nodrag nopan">
          <button type="button" className="btn sm" aria-label={n.name + ' 정보 편집'} disabled={editing.busy || !!editing.targetSource} onClick={() => editing.onSelect(n.id)}>정보 편집</button>
          {editing.targetSource
            ? <button type="button" className="btn pri sm" aria-label={n.name + ' 상대 선택'} disabled={editing.busy || n.id === editing.targetSource || n.unnamed} onClick={() => editing.onPick(n.id)}>상대 선택</button>
            : <button type="button" className="btn sm" aria-label={n.name + ' 관계 연결'} disabled={editing.busy || n.unnamed} onClick={() => editing.onConnect(n.id)}>관계 연결</button>}
        </div>
      </div>
    </>
  )
}

function RelationLine({ id, data }: EdgeProps<FlowRelation>) {
  const { editing, marker, setHot, openMenu } = useContext(GraphContext)
  if (!data) return null
  const edit = () => { if (data.relationId && !editing.busy) editing.onRelation(data.relationId) }
  const remove = () => { if (data.relationId && !editing.busy) editing.onDeleteRelation(data.relationId) }
  const onKeyDown = (e: ReactKeyboardEvent<SVGPathElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit() }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
    else if (isMenuKey(e) && data.relationId) { e.preventDefault(); openMenu({ kind: 'edge', relationId: data.relationId, ...centerOf(e.currentTarget) }) }
  }
  // 멀리·중간에서는 선이 화면에서 늘 가늘다(non-scaling-stroke: 캔버스를 줄여도 굵어지지 않고 누르는 자리도 12px로 남는다). 화살표는 멀리서는 그리지 않는다.
  const thin = data.level !== 'near', vector = thin ? 'non-scaling-stroke' : undefined
  return (
    <g className="relationship-edge">
      <path d={data.d} fill="none" stroke={data.color} strokeWidth={thin ? (data.active ? 2 : data.level === 'far' ? 1 : 1.5) : data.active ? 3 : 2} vectorEffect={vector} strokeDasharray={data.dashed ? '6 4' : undefined} markerEnd={data.arrow && data.level !== 'far' ? 'url(#' + marker + ')' : undefined} />
      <path d={data.d} className="relationship-edge-hit" fill="none" stroke="transparent" strokeWidth={thin ? 12 : 16} vectorEffect={vector} role="button" tabIndex={0} aria-label={data.name} onClick={edit} onKeyDown={onKeyDown} onMouseEnter={() => setHot(id)} onMouseLeave={() => setHot('')} onFocus={() => setHot(id)} onBlur={() => setHot('')}><title>{data.title}</title></path>
      {/* 마우스를 올리면 선 가운데 위쪽에 작은 편집·삭제 버튼이 뜬다(n8n처럼). 키보드·보조기기는 선의 Enter·Delete와 오른쪽 클릭 메뉴(ContextMenu 키)가 맡으므로 이 버튼은 보조기기에서 숨긴다. */}
      <g className="relationship-edge-tools" aria-hidden="true" transform={'translate(' + data.lx + ' ' + (data.ly - 26) + ')'}>
        <g data-action="edit" onClick={edit}><rect x={-47} y={-11} width={44} height={22} rx={11} /><text x={-25} y={4} textAnchor="middle">편집</text></g>
        <g data-action="delete" onClick={remove}><rect x={3} y={-11} width={44} height={22} rx={11} /><text x={25} y={4} textAnchor="middle">삭제</text></g>
      </g>
    </g>
  )
}

/** React Flow는 nodeTypes·edgeTypes가 렌더마다 새 객체면 노드를 다시 만든다: 모듈 상수로 둔다. */
const nodeTypes = { card: CardNode } satisfies NodeTypes
const edgeTypes = { relation: RelationLine } satisfies EdgeTypes

const finite = (p?: Point): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
/** 카드 중심(캔버스 좌표): 점·카드 어느 단계에서도 카드의 왼쪽 위 모서리(`p`)에서 같은 자리다. */
const cardCenter = (p: Point): Point => ({ x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 })

type CanvasProps = { vm: ReturnType<typeof useWorldMapViewModel>; editing: Actions; find?: { id: string; seq: number } | null }

/**
 * 카드 그래프(React Flow 캔버스, `@xyflow/react`는 이 파일에서만 쓴다): n8n처럼 캔버스에서 바로 조작한다.
 * - 보기: 점 격자 배경 위에서 휠·핀치로 확대·축소하고 빈 곳을 끌어 옮기며 카드를 끌 수 있다(끈 위치는 화면 상태일 뿐 저장하지 않는다). 처음에는 모든 카드를 한 화면에 맞춘다.
 * - 시맨틱 줌(옵시디언식): 확대 배율이 0.5 미만이면 카드 한 장이 관계 수에 비례하는 점 하나(far: 가는 선, 이름은 관계가 많은 몇 장만), 0.5 이상 0.9 미만이면 점 + 이름·선 라벨(mid), 0.9 이상이면 카드(near: 이름·초상·소개·끌어 잇는 점·버튼)다.
 *   배율이 아니라 단계가 바뀔 때만 다시 그린다. 카드 위치는 단계와 상관없이 같은 중심을 쓴다. 처음 배치와 '배치 정돈'은 힘 기반 배치(d3-force, 한 번에 계산)다.
 * - 도구: 왼쪽 위 도구 막대(`+ 설정 추가` 패널·`배치 정돈`·`화면 맞춤`), 왼쪽 아래 컨트롤(확대·축소·화면 맞춤). 새 카드는 보이는 화면 가운데(오른쪽 클릭이면 그 자리)의 빈 곳에 놓고 선택·확대하며 기존 카드는 움직이지 않는다.
 * - 오른쪽 클릭 메뉴(빈 곳·카드·선, 키보드는 ContextMenu 키·Shift+F10, 터치는 카드 길게 누르기), 카드 좌·우 점에서 끌어 잇기, 카드 더블클릭 = 정보 편집, 선 클릭·Enter = 편집, 선 Delete = 삭제, 선 가운데의 편집·삭제 버튼.
 * - 빈 캔버스에 초점이 있을 때(눌러서 초점을 줄 수 있고 Tab 순서에는 끼지 않는다) Tab은 `+ 설정 추가` 패널을 연다. 카드·선의 Tab은 평소대로 다음 요소로 간다.
 * 관계선 라벨(<text>)은 선에 마우스를 올리거나 초점을 둔 선(키보드는 카드 버튼에 초점이 있는 카드에 닿는 선)에만 그리고, 나머지 선은 <title> 툴팁·누르는 영역의 이름으로만 읽힌다(겹친 선의 라벨이 서로 가리지 않게).
 * 층: 간선(React Flow 간선 층) < 카드 < 라벨(뷰포트 포털의 SVG). 캔버스 높이는 CSS가 정하고, 이 컴포넌트는 캔버스 위쪽의 문서 위치만 `--rf-top`으로 알린다(관계도 보기가 '화면 높이 − 위쪽'을 채운다).
 */
export default function CharacterCards(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}

function Canvas({ vm, editing, find }: CanvasProps) {
  const rf = useReactFlow()
  const host = useRef<HTMLDivElement>(null)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const nodesIn = vm.graph.nodes
  const graphLinks = vm.graph.links.map((l) => ({ source: mapEndpoint(l.source), target: mapEndpoint(l.target) }))
  const [positions, setPositions] = useState(() => forceLayout(nodesIn, graphLinks))
  const level = useViewportStore((s) => zoomLevel(s.transform[2])) // 문자열이라 단계가 바뀔 때만 다시 그린다
  const { viewportStore } = useReactFlowStoreApi()
  const pending = useRef(new Map<string, Point>())
  const pressed = useRef(false)
  // 새 카드(아직 자리가 없는 카드)는 요청한 자리(`pending`)에, 그런 요청이 없으면 맨 오른쪽 옆에 놓는다. 기존 카드는 움직이지 않는다.
  useLayoutEffect(() => {
    const fresh = nodesIn.filter((n) => !positions.has(n.id))
    if (!fresh.length) return
    setPositions((old) => {
      const next = new Map(old)
      for (const n of fresh) {
        const all = [...next.values()].filter(finite)
        next.set(n.id, pending.current.get(n.id) ?? { x: Math.max(0, ...all.map((p) => p.x)) + CARD_W + 60, y: Math.min(0, ...all.map((p) => p.y)) })
      }
      return next
    })
  }, [nodesIn, positions])
  const marker = useId().replaceAll(':', '')
  const [hot, setHot] = useState(''), [focusCard, setFocusCard] = useState('') // hot: 마우스를 올리거나 초점을 둔 선, focusCard: 키보드 초점이 있는 카드(그 카드에 닿는 선의 라벨도 보인다)
  const [panel, setPanel] = useState(false), [menu, setMenu] = useState<MenuState | null>(null), [added, setAdded] = useState<{ id: string; seq: number } | null>(null)
  const panelOpener = useRef<HTMLElement | null>(null), seq = useRef(0)
  const at = (id: string) => { const p = positions.get(id) ?? pending.current.get(id); return finite(p) ? p : undefined } // NaN·무한대 좌표는 그리지 않는다

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
  // 캔버스 위쪽의 문서 위치(위 한 줄의 높이)를 CSS에 알린다: 렌더마다·창 크기가 바뀔 때 다시 잰다.
  const measure = useRef(() => {})
  measure.current = () => { const el = host.current; if (el) el.style.setProperty('--rf-top', Math.round(el.getBoundingClientRect().top + window.scrollY) + 'px') }
  useLayoutEffect(() => { measure.current() })
  useEffect(() => { const run = () => measure.current(); window.addEventListener('resize', run); return () => window.removeEventListener('resize', run) }, [])
  // 확대 배율을 CSS 변수 --rf-zoom으로 알린다(다시 그리지 않는다): 이름·선 라벨이 캔버스 배율과 상관없이 화면에서 늘 같은 크기이도록 CSS가 나눈다.
  useEffect(() => {
    let last = viewportStore.getState().transform[2]
    host.current?.style.setProperty('--rf-zoom', String(last))
    return viewportStore.subscribe((state) => { const zoom = state.transform[2]; if (zoom !== last) { last = zoom; host.current?.style.setProperty('--rf-zoom', String(zoom)) } })
  }, [viewportStore])

  /** 모든 카드가 상자 안에 들어오게 뷰포트를 정한다(이미 아는 카드 경계와 상자 크기로 직접 계산한다: 속성에 맡기면 상자 크기를 알기 전에 0×0으로 맞춘다). */
  const fitAll = (from: ReadonlyMap<string, Point> = positions) => {
    const el = host.current, list = nodesIn.map((n) => from.get(n.id)).filter(finite)
    if (!el || !list.length || !el.clientWidth || !el.clientHeight) return
    const xs = list.map((p) => p.x), ys = list.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys)
    void rf.setViewport(getViewportForBounds({ x, y, width: Math.max(...xs) + CARD_W - x, height: Math.max(...ys) + CARD_H - y }, el.clientWidth, el.clientHeight, FIT.minZoom, FIT.maxZoom, FIT.padding))
  }
  const fitLatest = useRef(fitAll)
  fitLatest.current = fitAll
  // 처음(상자가 보일 때마다)에는 전체를 맞춘 뒤에야 카드를 그린다: 기본 배율(1배)로 카드 수백 장을 먼저 그렸다가 점으로 바꾸는 낭비를 피한다.
  const [ready, setReady] = useState(false)
  useEffect(() => { if (sized) { fitLatest.current(); setReady(true) } else setReady(false) }, [sized])
  const relayout = () => { const next = new Map(positions); for (const [id, p] of forceLayout(nodesIn, graphLinks)) next.set(id, p); setPositions(next); fitAll(next) }
  const focusOn = (p: Point, zoom: number) => rf.setCenter(cardCenter(p).x, cardCenter(p).y, { zoom })

  // 설정 찾기(편집기가 id와 요청 번호를 준다): 그 카드가 캔버스 가운데에 오게 옮기고 확대는 줄이지 않는다.
  const findSeq = find?.seq
  useEffect(() => {
    const p = find && positions.get(find.id)
    if (p) void focusOn(p, Math.max(rf.getZoom(), 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 요청 번호가 바뀔 때만 움직인다
  }, [findSeq])

  const closePanel = () => { setPanel(false); const back = panelOpener.current; if (back?.isConnected) back.focus() }
  const openPanel = (from: HTMLElement | null) => { panelOpener.current = from; setMenu(null); setPanel(true) }
  /** 새 카드를 `center`(캔버스 좌표, 없으면 보이는 화면 가운데)를 가운데로 하는 빈 자리에 놓는다. */
  const addAt = (type: CardType, center?: Point) => {
    const id = editingRef.current.onAdd(type)
    if (!id) return
    const el = host.current
    const target = center ?? (el ? (() => { const r = el.getBoundingClientRect(); return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })() : { x: 0, y: 0 })
    pending.current.set(id, freeSpot({ x: target.x - CARD_W / 2, y: target.y - CARD_H / 2 }, [...positions.values()].filter(finite)))
    setPanel(false)
    setAdded({ id, seq: ++seq.current })
  }
  // 새 카드가 그래프에 나타나면 선택하고 가운데로 확대하며 초점을 준다(캔버스에 머문다: 편집 화면으로 가지 않는다).
  useEffect(() => {
    if (!added) return
    const p = positions.get(added.id)
    if (!p || !nodesIn.some((n) => n.id === added.id)) return
    setAdded(null)
    editingRef.current.onMark(added.id)
    void focusOn(p, Math.max(rf.getZoom(), 1))
    host.current?.querySelector<HTMLElement>('[data-id="' + added.id + '"]')?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 새 카드가 생겼는지만 본다
  }, [added, positions, nodesIn])

  const names = new Map(nodesIn.map((n) => [n.id, n.name])), title = (id: string) => names.get(id) ?? '인물'
  const subject = nodesIn.some((n) => n.kind !== '인물') ? '설정' : '인물'
  const canDrag = !editing.busy && !editing.targetSource // 상대를 고르는 중에는 카드를 끌지 않고 누르기만 받는다
  const openMenu = (next: MenuState) => { setPanel(false); setMenu(next) }
  // 키보드 초점이 간 카드(`card`: 노드 래퍼나 안쪽 카드, `center`: 카드 중심의 캔버스 좌표)가 캔버스 밖이면 그 카드가 가운데 오게 옮긴다. 배율은 그대로다.
  // React Flow의 노드 초점 자동 이동은 disableKeyboardA11y라 꺼져 있고, 카드 안 버튼의 초점은 원래 따라가지 않는다.
  const reveal = (card: HTMLElement, center: Point) => {
    const view = card.closest('.react-flow')?.getBoundingClientRect(), box = card.getBoundingClientRect()
    if (view && (box.left < view.left || box.right > view.right || box.top < view.top || box.bottom > view.bottom)) void rf.setCenter(center.x, center.y, { zoom: rf.getZoom() })
  }
  const nodeKeyDown = (n: MapNode) => (e: ReactKeyboardEvent<HTMLDivElement>) => { // 카드 자체에 초점이 있을 때만(카드 안 버튼의 키는 그 버튼이 쓴다)
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') { e.preventDefault(); if (!editing.busy) editing.onSelect(n.id) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!editing.busy) editing.onDeleteCard(n.id) }
    else if (isMenuKey(e)) { e.preventDefault(); openMenu({ kind: 'node', id: n.id, ...centerOf(e.currentTarget) }) }
  }
  const ids = nodesIn.map((n) => n.id), degree = degrees(ids, graphLinks), maxDegree = Math.max(0, ...degree.values()), named = topDegreeIds(ids, degree, labelLimit(nodesIn.length))
  /** 카드 한 장이 지금 단계에서 차지하는 상자: 가까이서는 카드(200×150), 멀리·중간에서는 관계 수에 비례하는 점(중심은 같다). */
  const box = (id: string) => level === 'near' ? { w: CARD_W, h: CARD_H } : { w: dotDiameter(degree.get(id) ?? 0, maxDegree), h: dotDiameter(degree.get(id) ?? 0, maxDegree) }
  const nodes: FlowCard[] = nodesIn.map((n) => {
    const selected = vm.selected?.id === n.id, p = at(n.id), center = p ? cardCenter(p) : { x: 0, y: 0 }, { w, h } = box(n.id)
    return {
      id: n.id, type: 'card', position: { x: center.x - w / 2, y: center.y - h / 2 }, width: w, height: h, measured: { width: w, height: h }, handles: HANDLES, draggable: canDrag,
      ariaRole: 'group', ariaLabel: n.name + ' ' + n.kind + ' 카드', domAttributes: { 'aria-current': selected || undefined, 'aria-roledescription': '카드', onKeyDown: nodeKeyDown(n), onFocus: (e: ReactFocusEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) reveal(e.currentTarget, center) } },
      data: { n, selected, target: !!editing.targetSource && n.id !== editing.targetSource, dim: !vm.visible.has(n.id), level, diameter: w, named: named.has(n.id), center },
    }
  })
  const edges: FlowRelation[] = vm.graph.links.flatMap((l, i) => {
    const source = mapEndpoint(l.source), target = mapEndpoint(l.target), a = at(source), b = at(target)
    if (!a || !b) return []
    const { x: ax, y: ay } = cardCenter(a), { x: bx, y: by } = cardCenter(b), dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1
    // 선은 카드 가장자리(가까이)·점 가장자리(멀리·중간)에서 시작하고 끝난다.
    const cut = (id: string) => level === 'near' ? Math.min((CARD_W / 2 + 10) / Math.max(1, Math.abs(dx)), (CARD_H / 2 + 10) / Math.max(1, Math.abs(dy))) : (box(id).w / 2 + 4) / length
    const fs = cut(source), ft = cut(target)
    const sx = ax + dx * fs, sy = ay + dy * fs, tx = bx - dx * ft, ty = by - dy * ft, c = l.curve ?? 0
    const qx = (ax + bx) / 2 + dy * c, qy = (ay + by) / 2 - dx * c, active = !!l.id && editing.selectedRelations.includes(l.id), key = l.id ?? String(i)
    const full = title(source) + ' · ' + title(target) + ' · ' + (l.fullLabel ?? l.label)
    return [{
      id: key, type: 'relation', source, target,
      ariaRole: 'none', ariaLabel: NO_ARIA_LABEL, // 기본 래퍼는 role=img(자식을 읽지 못한다)·영어 이름(카드 id)이다: 이름 있는 선 버튼이 이 안에 있으니 래퍼는 의미를 갖지 않는다
      data: {
        level, relationId: l.id, d: 'M ' + sx + ' ' + sy + ' Q ' + qx + ' ' + qy + ' ' + tx + ' ' + ty, active, dashed: !!l.emotion, arrow: !l.symmetric, label: l.label,
        lx: (sx + 2 * qx + tx) / 4, ly: (sy + 2 * qy + ty) / 4, deg: Math.round(labelAngle(tx - sx, ty - sy) * 10) / 10, // 곡선의 가운데(t=½)와 선 방향
        color: active ? 'var(--edge-active,var(--pri))' : l.emotion ? 'var(--edge-emotion,var(--acc-ink))' : 'var(--edge,var(--pri-ink))',
        name: '관계선 편집: ' + full, title: l.fullLabel ?? l.label, full,
      },
    }]
  })
  // 라벨: 멀리서는 없고, 중간에서는 모든 선에, 가까이서는 선에 마우스를 올리거나 초점을 둔 선·키보드 초점이 있는 카드에 닿는 선에만 그린다(수십 개의 라벨이 서로 겹치지 않게). 선 자체는 툴팁·이름으로 늘 읽힌다.
  const labelled = level === 'far' ? [] : level === 'mid' ? edges : edges.filter((e) => hot === e.id || e.source === focusCard || e.target === focusCard)
  // 카드 본문을 누를 때: 카드 안 버튼의 누르기는 제외한다. 끌고 놓은 직후의 click은 React Flow가 막아 여기까지 오지 않는다(`preventNextClick`). 길게 눌러 메뉴를 연 뒤의 click도 건너뛴다.
  const onNodeClick = (event: ReactMouseEvent, node: Node) => {
    if (pressed.current) { pressed.current = false; return }
    if (editing.busy || (event.target instanceof Element && event.target.closest('button'))) return
    const p = at(node.id)
    if (level === 'far' && p && !editing.targetSource) { editing.onMark(node.id); void focusOn(p, ZOOM_TO_NODE); return } // 멀리서 점을 누르면 그 카드로 다가간다(상대를 고르는 중에는 상대로 고른다)
    editing.onPick(node.id)
  }
  // 13.0.2의 변경 묶음은 배열이 아니라 `NodeChangeset`이다. 쓰는 것은 끌어 옮긴 위치(position)뿐이다.
  const onNodesChange: OnNodesChange<FlowCard> = (changes) => {
    // 끈 상자의 왼쪽 위(position)를 카드 기준 자리(카드의 왼쪽 위)로 되돌려 저장한다: 점 단계에서는 상자가 점이다.
    const moved = changes.getByType('position').flatMap((c) => { if (!finite(c.position)) return []; const { w, h } = box(c.id); return [[c.id, { x: c.position.x + w / 2 - CARD_W / 2, y: c.position.y + h / 2 - CARD_H / 2 }] as [string, Point]] })
    if (moved.length) setPositions((old) => { const next = new Map(old); for (const [id, position] of moved) next.set(id, position); return next })
  }
  const unnamed = new Map(nodesIn.map((n) => [n.id, n]))
  const isValidConnection = (c: Edge | Connection) => !editing.busy && !editing.targetSource && validConnection({ source: c.source, target: c.target }, unnamed)
  const onConnect = (c: Connection) => { if (isValidConnection(c)) editing.onPair(c.source, c.target) }

  const menuEntries = (m: MenuState): MenuEntry[] => {
    if (m.kind === 'pane') return [
      { label: '여기에 설정 추가', items: cardTypes.map((t) => ({ label: t.label, disabled: editing.busy, onSelect: () => addAt(t.id, m.flow) })) },
      { label: '배치 정돈', onSelect: relayout },
      { label: '화면 맞춤', onSelect: () => fitAll() },
    ]
    if (m.kind === 'node') {
      const n = unnamed.get(m.id)
      return [
        { label: '정보 편집', disabled: editing.busy, onSelect: () => editing.onSelect(m.id) },
        { label: '관계 연결', disabled: editing.busy || !n || !!n.unnamed, onSelect: () => editing.onConnect(m.id) },
        { label: '삭제', disabled: editing.busy || !!editing.deleteLock, reason: editing.deleteLock || undefined, onSelect: () => editing.onDeleteCard(m.id) },
      ]
    }
    return [
      { label: '관계 편집', disabled: editing.busy, onSelect: () => editing.onRelation(m.relationId) },
      { label: '관계 삭제', disabled: editing.busy, onSelect: () => editing.onDeleteRelation(m.relationId) },
    ]
  }
  const menuLabel = (m: MenuState) => m.kind === 'pane' ? '캔버스 메뉴' : m.kind === 'node' ? title(m.id) + ' 메뉴' : '관계선 메뉴'
  const context = { editing, marker, setHot, setFocusCard, openMenu, reveal, pressed }
  return (
    <div
      ref={host} className="relationship-flow" data-level={level} role="group" aria-label={subject + ' 카드 그래프'} tabIndex={-1}
      onKeyDown={(e) => { // 캔버스 자체에 초점이 있을 때만(카드·선·버튼·입력칸의 키는 그쪽이 쓴다)
        if (e.target !== e.currentTarget) return
        if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openPanel(e.currentTarget) }
        else if (isMenuKey(e)) { e.preventDefault(); const c = centerOf(e.currentTarget); openMenu({ kind: 'pane', ...c, flow: rf.screenToFlowPosition(c) }) }
      }}
    >
      <svg className="relationship-marker-defs" aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge,var(--pri-ink))" /></marker></defs></svg>
      {sized && <GraphContext.Provider value={context}>
        {/* 카드는 선택·삭제·방향키 이동을 React Flow에 맡기지 않고(우리 쪽 키·메뉴가 한다) 초점은 받는다. disableKeyboardA11y는 노드의 영어 키보드 안내(aria-describedby)를 걷고, panActivationKeyCode·deleteKeyCode의 null은 Space·Backspace를 document에서 가로채는 기본 단축키를 꺼서 Space로 페이지를 내릴 수 있게 한다. */}
        <ReactFlow
          nodes={ready ? nodes : []} edges={ready ? edges : []} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeClick={onNodeClick} onNodeDoubleClick={(_, node) => { if (!editing.busy) editing.onSelect(node.id) }}
          onPaneContextMenu={(e) => { e.preventDefault(); openMenu({ kind: 'pane', x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) }) }}
          onNodeContextMenu={(e, node) => { e.preventDefault(); openMenu({ kind: 'node', id: node.id, x: e.clientX, y: e.clientY }) }}
          onEdgeContextMenu={(e, edge) => { e.preventDefault(); const relationId = (edge as FlowRelation).data?.relationId; if (relationId) openMenu({ kind: 'edge', relationId, x: e.clientX, y: e.clientY }) }}
          onConnect={onConnect} isValidConnection={isValidConnection} connectionRadius={130}
          nodeDragThreshold={4} nodesConnectable elementsSelectable={false} edgesFocusable={false} disableKeyboardA11y deleteKeyCode={null} panActivationKeyCode={null} zoomOnDoubleClick={false}
          minZoom={FIT.minZoom} maxZoom={1.75} forceColorMode="dark" ariaLabelConfig={ARIA}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />
          <Controls showInteractive={false} fitViewOptions={FIT} />
          <Panel position="top-left" className="relationship-tools" role="toolbar" aria-label="관계도 도구">
            <button type="button" className="btn sm" aria-haspopup="dialog" aria-expanded={panel} onClick={(e) => { if (panel) closePanel(); else openPanel(e.currentTarget) }}>+ 설정 추가</button>
            <button type="button" className="btn sm" onClick={relayout}>배치 정돈</button>
            <button type="button" className="btn sm" onClick={() => fitAll()}>화면 맞춤</button>
          </Panel>
          <ViewportPortal>
            <svg className="relationship-card-labels" aria-hidden="true">
              {labelled.map((e) => {
                const d = e.data!
                return <text key={e.id} x={d.lx} y={level === 'mid' ? d.ly : d.ly - 7} textAnchor="middle" fill={d.color} className="relationship-edge-label" transform={'rotate(' + d.deg + ' ' + d.lx + ' ' + d.ly + ')'}>{d.label}</text>
              })}
            </svg>
          </ViewportPortal>
        </ReactFlow>
      </GraphContext.Provider>}
      {panel && <AddCardPanel busy={editing.busy} onAdd={(type) => addAt(type)} onClose={closePanel} />}
      {menu && <RelationContextMenu key={menu.kind + ':' + menu.x + ':' + menu.y} label={menuLabel(menu)} x={menu.x} y={menu.y} entries={menuEntries(menu)} onClose={() => setMenu(null)} />}
    </div>
  )
}
