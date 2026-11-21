import '@xyflow/react/dist/style.css'
import { Background, BackgroundVariant, ControlButton, Controls, Handle, Position, ReactFlow, ReactFlowProvider, getViewportForBounds, useReactFlow, useReactFlowStoreApi, useViewportStore, type AriaLabelConfig, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type EdgeTypes, type OnNodesChange, type Viewport } from '@xyflow/react'
import { createPortal } from 'react-dom'
import { createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { presentationPortrait } from '../../../../app/presentationPortraits'
import { cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'
import { labelAngle } from '../viewmodel/characterMap'
import { CARD_H, CARD_W, bodyBox, nearestFree, validConnection, type Box, type Point } from '../viewmodel/canvasLayout'
import { forceLayout } from '../viewmodel/forceLayout'
import { focusStyle, neighborhood } from '../viewmodel/highlight'
import { placeLabels, type LabelNode, type View } from '../viewmodel/labelLayout'
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
/** 카드 한 장을 그리는 값: 확대 단계(`level`)마다 모양이 다르다. `center`는 단계와 상관없는 카드 중심(캔버스 좌표)이다(점의 이름표는 별도의 화면 좌표 층이 그린다). */
type CardData = { n: MapNode; selected: boolean; target: boolean; dim: boolean; level: ZoomLevel; center: Point }
type FlowCard = Node<CardData, 'card'>
/** 간선 한 개를 그리는 값: 카드 가장자리에서 가장자리까지의 곡선(`d`), 라벨 자리(`lx`·`ly`)와 눕는 각도(`deg`), 이름·색. 좌표는 캔버스 좌표다. */
type RelationData = { level: ZoomLevel; relationId?: string; d: string; lx: number; ly: number; deg: number; color: string; active: boolean; dashed: boolean; arrow: boolean; label: string; name: string; title: string; full: string }
type FlowRelation = Edge<RelationData, 'relation'>
/** 열린 오른쪽 클릭 메뉴: 빈 곳(`flow` = 누른 자리의 캔버스 좌표)·카드·선. 좌표 x·y는 화면 좌표다. */
type MenuState = { x: number; y: number } & ({ kind: 'pane'; flow: Point } | { kind: 'node'; id: string } | { kind: 'edge'; relationId: string })

/**
 * 자주 바뀌는 상태(선 hover, 카드 hover·초점·고정)의 작은 저장소: Canvas의 state로 두면 바뀔 때마다 Canvas와 모든 카드·선이 다시 그려지므로, 그 값을 읽는 곳(그 선·강조 CSS·이름표 층)만 구독한다.
 * 구독자에게는 `useSlice`가 고른 값(true/false 같은 원시값)이 바뀔 때만 알린다.
 */
type Store<T> = { get: () => T; set: (next: T) => void; subscribe: (listener: () => void) => () => void }
function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => { if (!Object.is(next, value)) { value = next; listeners.forEach((listener) => listener()) } },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
const useSlice = <T, S>(store: Store<T>, select: (value: T) => S): S => useSyncExternalStore(store.subscribe, () => select(store.get()))
/** 항상 같은 함수 객체를 돌려주되 부를 때는 가장 최근 렌더의 함수를 부른다: React Flow의 핸들러 prop이 렌더마다 바뀌어 모든 노드의 래퍼를 다시 그리게 하지 않는다. */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  latest.current = fn
  return useCallback((...args: A) => latest.current(...args), [])
}
/** 두 값이 `depth`단계 안쪽까지 같은 내용인지(객체는 키마다 비교, 함수·배열은 같은 객체여야 같다). */
function same(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true
  if (depth === 0 || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth - 1))
}
/**
 * 내용이 같은 항목은 이전 객체를 그대로, 모두 같으면 이전 배열을 그대로 돌려준다: React Flow는 바뀐 노드·선만 다시 처리하고 memo한 카드·선은 바뀐 것만 다시 그려진다.
 * (카드 하나를 끌 때 그 카드와 닿은 선만, hover·메뉴 열기·같은 단계의 확대는 아무것도 다시 그리지 않는다.)
 */
function useStableList<T extends { id: string }>(list: T[]): T[] {
  const memo = useRef<{ byId: Map<string, T>; list: T[] }>({ byId: new Map(), list: [] })
  const next = list.map((item) => { const old = memo.current.byId.get(item.id); return old && same(old, item, 3) ? old : item })
  const previous = memo.current.list
  const stable = previous.length === next.length && next.every((item, index) => item === previous[index]) ? previous : next
  memo.current = { byId: new Map(stable.map((item) => [item.id, item])), list: stable }
  return stable
}

/**
 * 카드·선·이름표 층이 쓰는 값. 편집기가 다시 그려져도 바뀌지 않는다(바뀌면 모든 카드·선이 다시 그려진다): 편집 동작은 `live`(가장 최근 것)에서 부를 때 읽고, hover·초점은 저장소로 나눠 읽는다
 * (`hot`: 마우스를 올리거나 초점이 간 선, `hover`: 마우스가 올라간 카드, `focused`: 키보드 초점(`:focus-visible`)이 있는 카드, `pinned`: 눌러 고정한 강조 카드).
 * 바뀌는 것은 `busy`(처리 중)·`source`(연결을 시작한 카드)뿐이다: 연결 모드를 켜고 끌 때는 모든 카드의 버튼이 바뀌어야 하고, 같은 렌더에서 DOM이 바뀌어야 편집기가 그 직후 초점을 돌려줄 수 있다.
 */
type Graph = { live: MutableRefObject<Actions>; marker: string; hot: Store<string>; hover: Store<string>; focused: Store<string>; pinned: Store<string>; openMenu: (menu: MenuState) => void; reveal: (card: HTMLElement, center: Point) => void; pressed: MutableRefObject<boolean>; busy: boolean; source: string | null }
const GraphContext = createContext<Graph>(undefined as unknown as Graph)

/**
 * 화면 맞춤: 카드 글자가 읽히도록 원래 크기(1배)까지만 키우고 0.05배까지 줄인다(카드 수백 장이 한 화면에 들어온다). 처음·도구 막대·컨트롤의 화면 맞춤이 같은 값을 쓴다.
 * 여백은 캔버스 위에 겹친 것의 자리다: 위는 숨 쉴 자리(24px: 도구 막대는 캔버스 위 한 줄로 올라가 캔버스에 겹치지 않는다), 왼쪽은 아래 컨트롤(72px), 아래는 가운데 안내문 + 범례(88px). 카드가 그 밑으로 들어가지 않는다.
 */
const FIT = { padding: { top: '24px', right: '24px', bottom: '88px', left: '72px' }, minZoom: 0.05, maxZoom: 1 } as const
/** + 설정 추가 패널의 폭(CSS `width:min(300px,100%)`와 같다): 패널이 열린 채 화면 맞춤을 하면 그만큼(+16px)을 오른쪽에 비워 카드가 패널 밑에 들어가지 않게 한다. */
const PANEL_W = 300
/** 카드가 이만큼 많으면 화면 밖 카드는 그리지 않는다(onlyRenderVisibleElements). 적을 때는 모두 그려 키보드(Tab)로 모든 카드에 닿는다. */
const VISIBLE_ONLY_FROM = 40
/** 길게 누르기(터치)로 카드 메뉴를 여는 시간과 그 사이 허용하는 움직임(px). */
const LONG_PRESS_MS = 600, LONG_PRESS_MOVE = 10
/** React Flow의 영어 컨트롤 이름을 한국어로 바꾼다. */
const ARIA: Partial<AriaLabelConfig> = { 'controls.ariaLabel': '관계도 조작', 'controls.zoomIn.ariaLabel': '확대', 'controls.zoomOut.ariaLabel': '축소', 'controls.fitView.ariaLabel': '화면에 맞추기' }
const NO_NODES: FlowCard[] = [], NO_EDGES: FlowRelation[] = []
/** 컨트롤의 화면 맞춤 아이콘(React Flow 기본 아이콘과 같다). 기본 맞춤 버튼은 속으로 React Flow의 fitView(노드 경계·여백 10%·최대 1.75배)를 따로 돌려 우리 맞춤을 뒤늦게 덮어쓰므로 쓰지 않고, 이 버튼이 도구 막대의 화면 맞춤과 같은 맞춤 하나만 부른다. */
const FitIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30"><path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" /></svg>

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

const isMenuKey = (e: ReactKeyboardEvent) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
const centerOf = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

const CardNode = memo(function CardNode({ data }: NodeProps<FlowCard>) {
  const { live, openMenu, reveal, pressed, busy, source } = useContext(GraphContext)
  const { n, selected, target, dim, level, center } = data
  const portrait = presentationPortrait(n.name)
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const cancelPress = () => { if (press.current) { window.clearTimeout(press.current.timer); press.current = null } }
  const connectable = !busy && !n.unnamed && !source
  const state = (selected ? ' selected' : '') + (target ? ' target' : '') + (dim ? ' dim' : '')
  // 카드와 점이 함께 쓰는 초점·길게 누르기(터치는 길게 누르면 오른쪽 클릭 메뉴가 열린다: 손가락에는 오른쪽 클릭이 없다)
  const shared = {
    onFocus: (e: ReactFocusEvent<HTMLDivElement>) => reveal(e.currentTarget, center),
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
  // 멀리(far)·중간(mid)에서는 카드 대신 유형 색의 점이다(이름표는 화면 좌표 층이 노드 바로 아래에 그린다). 카드 본문·버튼은 가까이(near)에서만 있다.
  if (level !== 'near') {
    return (
      <>
        {ports}
        <div className={'relationship-dot' + state} style={{ background: n.type ? CARD_COLORS[CARD_KIND[n.type]] : 'var(--fixed-sub)' }} {...shared} />
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
          <button type="button" className="btn sm" aria-label={n.name + ' 정보 편집'} disabled={busy || !!source} onClick={() => live.current.onSelect(n.id)}>정보 편집</button>
          {source
            ? <button type="button" className="btn pri sm" aria-label={n.name + ' 상대 선택'} disabled={busy || n.id === source || n.unnamed} onClick={() => live.current.onPick(n.id)}>상대 선택</button>
            : <button type="button" className="btn sm" aria-label={n.name + ' 관계 연결'} disabled={busy || n.unnamed} onClick={() => live.current.onConnect(n.id)}>관계 연결</button>}
        </div>
      </div>
    </>
  )
})

const RelationLine = memo(function RelationLine({ id, data }: EdgeProps<FlowRelation>) {
  const { live, marker, hot, openMenu } = useContext(GraphContext)
  const isHot = useSlice(hot, (key) => key === id) // 마우스를 올리거나 초점이 간 선 하나만 이 값이 바뀐다
  if (!data) return null
  const edit = () => { if (data.relationId && !live.current.busy) live.current.onRelation(data.relationId) }
  const remove = () => { if (data.relationId && !live.current.busy) live.current.onDeleteRelation(data.relationId) }
  const onKeyDown = (e: ReactKeyboardEvent<SVGPathElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit() }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
    else if (isMenuKey(e) && data.relationId) { e.preventDefault(); openMenu({ kind: 'edge', relationId: data.relationId, ...centerOf(e.currentTarget) }) }
  }
  // 멀리·중간에서는 선이 화면에서 늘 가늘다(non-scaling-stroke: 캔버스를 줄여도 굵어지지 않고 누르는 자리도 12px로 남는다). 화살표는 멀리서는 그리지 않는다.
  const thin = data.level !== 'near', vector = thin ? 'non-scaling-stroke' : undefined
  return (
    <g className="relationship-edge" onMouseEnter={() => hot.set(id)} onMouseLeave={() => hot.set('')}>
      <path d={data.d} fill="none" stroke={data.color} strokeWidth={thin ? (data.active ? 2 : data.level === 'far' ? 1 : 1.5) : data.active ? 3 : 2} vectorEffect={vector} strokeDasharray={data.dashed ? '6 4' : undefined} markerEnd={data.arrow && data.level !== 'far' ? 'url(#' + marker + ')' : undefined} />
      <path d={data.d} className="relationship-edge-hit" fill="none" stroke="transparent" strokeWidth={thin ? 12 : 16} vectorEffect={vector} role="button" tabIndex={0} aria-label={data.name} onClick={edit} onKeyDown={onKeyDown} onFocus={() => hot.set(id)} onBlur={() => hot.set('')}><title>{data.title}</title></path>
      {/* 마우스를 올리거나 초점이 간 선(가까이서만) 가운데 위쪽에 작은 편집·삭제 버튼이 뜬다(n8n처럼): 나머지 선은 이 요소를 만들지 않는다. 키보드·보조기기는 선의 Enter·Delete와 오른쪽 클릭 메뉴(ContextMenu 키)가 맡으므로 보조기기에서 숨긴다.
          투명한 bridge는 선과 버튼 사이 틈을 이어 그 틈을 지나는 동안 버튼이 사라지지 않게 한다. */}
      {isHot && data.level === 'near' && (
        <g className="relationship-edge-tools" aria-hidden="true" transform={'translate(' + data.lx + ' ' + (data.ly - 26) + ')'}>
          <rect className="relationship-edge-bridge" x={-47} y={11} width={94} height={19} />
          <g data-action="edit" onClick={edit}><rect x={-47} y={-11} width={44} height={22} rx={11} /><text x={-25} y={4} textAnchor="middle">편집</text></g>
          <g data-action="delete" onClick={remove}><rect x={3} y={-11} width={44} height={22} rx={11} /><text x={25} y={4} textAnchor="middle">삭제</text></g>
        </g>
      )}
    </g>
  )
})

/** 이벤트 대상이 속한 카드(노드 래퍼)의 id. 카드 밖이면 ''이다. */
const nodeIdOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('.react-flow__node')?.getAttribute('data-id') ?? '' : '')

/** 지금 강조할 대상: 마우스가 올라간 카드, 없으면 키보드 초점이 있는 카드, 없으면 눌러 고정한 카드와 그 이웃·닿는 선. 이웃은 React Flow에 주는 선(`edges`) 그대로 구한다. 없거나 이미 지워진 카드면 null이다. */
function useAround(nodes: readonly LabelNode[], edges: readonly FlowRelation[]) {
  const { hover, focused, pinned } = useContext(GraphContext)
  const hovered = useSlice(hover, (id) => id), keyed = useSlice(focused, (id) => id), held = useSlice(pinned, (id) => id), id = hovered || keyed || held
  return useMemo(() => (id && nodes.some((n) => n.id === id) ? { id, ...neighborhood(id, edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))) } : null), [id, nodes, edges])
}

/**
 * 강조 모드의 CSS(옵시디언식): 마우스를 올리거나 키보드 초점이 간 카드(없으면 눌러 고정한 카드)와 직접 이어진 이웃·그 사이 선만 또렷하고 나머지는 흐리다(눌리기는 한다). 카드·선을 다시 만들지 않고 이 한 덩어리 CSS만 바꾼다.
 * 유형 필터로 흐린 카드(`.dim`)는 이것과 따로 계속 흐리다. 이미 지워진 카드를 가리키면 강조하지 않는다.
 */
const FocusStyle = memo(function FocusStyle({ nodes, edges }: { nodes: LabelNode[]; edges: FlowRelation[] }) {
  const around = useAround(nodes, edges)
  return around && <style className="relationship-focus-style" data-focus={around.id}>{focusStyle(around.nodes, around.edges)}</style>
})

/** 이름표 층이 쓰는 지금 화면(캔버스 원점의 화면 위치·배율·상자 크기): 뷰포트가 바뀌어도 한 프레임에 한 번만 갱신해 이름표 수십 개만 다시 그린다. */
function useView(): View {
  const { viewportStore } = useReactFlowStoreApi()
  const [view, setView] = useState<View>(() => readView(viewportStore.getState()))
  useEffect(() => {
    const update = () => setView((old) => { const next = readView(viewportStore.getState()); return old.x === next.x && old.y === next.y && old.k === next.k && old.w === next.w && old.h === next.h ? old : next })
    update()
    let frame = 0
    const stop = viewportStore.subscribe(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update() }) })
    return () => { stop(); if (frame) cancelAnimationFrame(frame) }
  }, [viewportStore])
  return view
}
const readView = ({ transform: [x, y, k], width: w, height: h }: { transform: [number, number, number]; width: number; height: number }): View => ({ x, y, k, w, h })

/** 이름표를 붙일 노드 + 유형 필터·검색에 맞지 않아 흐린 노드(이름도 흐리다). */
type NameNode = LabelNode & { dim: boolean }

/**
 * 이름표 층(화면 좌표, 확대 배율을 따라 커지지 않는다): 멀리·중간의 노드 이름은 점 바로 아래 화면 4px에 12~14px로 붙고(`placeLabels`: 겹치면 관계가 적은 쪽을 숨긴다, 강조한 카드·이웃·고른 카드는 겹쳐도 보인다),
 * 선 위 관계 이름은 모든 단계에서 기본 숨김이고 마우스를 올리거나 키보드 초점이 간(`hot`) 선·고른(`active`: 관계 작성 중인) 선에만 그 선 위에 보인다. 가까이서는 카드 안에 이름이 있어 노드 이름표가 없다.
 * 뷰포트를 따라 한 프레임에 한 번 이 층만(수십 개) 다시 그리고, 카드·선은 건드리지 않는다.
 */
const LabelLayer = memo(function LabelLayer({ nodes, edges, level, selected }: { nodes: NameNode[]; edges: FlowRelation[]; level: ZoomLevel; selected: string }) {
  const { hot } = useContext(GraphContext)
  const hotId = useSlice(hot, (id) => id)
  const lines = edges.filter((e) => e.id === hotId || e.data!.active)
  const view = useView()
  const candidates = useMemo(() => (level === 'far' ? topDegreeIds(nodes.map((n) => n.id), new Map(nodes.map((n) => [n.id, n.degree])), labelLimit(nodes.length)) : new Set(nodes.map((n) => n.id))), [nodes, level])
  const around = useAround(nodes, edges)
  const always = useMemo(() => new Set<string>([...(selected ? [selected] : []), ...(around?.nodes ?? [])]), [selected, around])
  const names = level === 'near' ? [] : placeLabels(nodes, view, candidates, always)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return (
    <div className="relationship-names" aria-hidden="true">
      {names.map((label) => {
        const node = byId.get(label.id)!
        return <div key={label.id} className={'relationship-name' + (node.dim ? ' dim' : '') + (around && !around.nodes.has(label.id) ? ' faded' : '')} style={{ transform: 'translate(' + label.x + 'px,' + label.y + 'px) translateX(-50%)', fontSize: label.size }}>{node.name}</div>
      })}
      {lines.map((e) => {
        const d = e.data!
        return <div key={e.id} className="relationship-edge-name" style={{ transform: 'translate(' + (d.lx * view.k + view.x) + 'px,' + (d.ly * view.k + view.y) + 'px) rotate(' + d.deg + 'deg) translate(-50%,-50%)' }}>{d.label}</div>
      })}
    </div>
  )
})

/** React Flow는 nodeTypes·edgeTypes가 렌더마다 새 객체면 노드를 다시 만든다: 모듈 상수로 둔다. */
const nodeTypes = { card: CardNode } satisfies NodeTypes
const edgeTypes = { relation: RelationLine } satisfies EdgeTypes

const finite = (p?: Point): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
/** 카드 중심(캔버스 좌표): 점·카드 어느 단계에서도 카드의 왼쪽 위 모서리(`p`)에서 같은 자리다. */
const cardCenter = (p: Point): Point => ({ x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 })

/** `toolsSlot`: 도구 막대(+ 설정 추가·배치 정돈·화면 맞춤)를 그릴 자리다. 편집기가 유형 필터·설정 찾기와 같은 줄에 두려고 캔버스 밖(위 한 줄)에 만든 요소를 주고, 아직 없으면(첫 렌더) null이다. */
type CanvasProps = { vm: ReturnType<typeof useWorldMapViewModel>; editing: Actions; find?: { id: string; seq: number } | null; toolsSlot: HTMLElement | null }

/**
 * 카드 그래프(React Flow 캔버스, `@xyflow/react`는 이 파일에서만 쓴다): n8n처럼 캔버스에서 바로 조작한다.
 * - 보기: 점 격자 배경 위에서 휠·핀치로 확대·축소하고 빈 곳을 끌어 옮기며 카드를 끌 수 있다(끈 위치는 화면 상태일 뿐 저장하지 않는다). 처음에는 모든 카드를 한 화면에 맞춘다.
 * - 시맨틱 줌(옵시디언식): 확대 배율이 0.5 미만이면 카드 한 장이 관계 수에 비례하는 점 하나(far: 가는 선, 이름은 관계가 많은 몇 장만), 0.5 이상 0.9 미만이면 점 + 이름(mid), 0.9 이상이면 카드(near: 이름·초상·소개·끌어 잇는 점·버튼)다.
 *   배율이 아니라 단계가 바뀔 때만 다시 그린다(배율은 CSS 변수로도 쓰지 않는다: 휠 틱마다 하위 요소 전체의 스타일을 다시 계산하게 된다). 카드 위치는 단계와 상관없이 같은 중심을 쓴다. 처음 배치와 '배치 정돈'은 힘 기반 배치(d3-force, 한 번에 계산, 어느 단계에서도 노드 상자가 겹치지 않는다)다.
 * - 이름표·강조: 점 이름과 선 위 관계 이름은 화면 좌표 층(`LabelLayer`)이 그린다. 카드에 마우스를 올리거나 초점이 가면(없으면 눌러 고정한 카드) 그 카드·이웃·사이 선만 또렷하고 나머지는 흐리다(`FocusStyle`의 CSS 한 덩어리).
 * - 도구: 캔버스 위 한 줄의 도구 막대(`+ 설정 추가` 패널·`배치 정돈`·`화면 맞춤`: 편집기가 준 `toolsSlot`에 그려 캔버스를 가리지 않는다), 왼쪽 아래 컨트롤(확대·축소·화면 맞춤). 새 카드는 보이는 화면 가운데(오른쪽 클릭이면 그 자리)에서 가장 가까운 빈 자리에 놓고 선택·확대하며 기존 카드는 움직이지 않는다. 끌어 놓은 카드가 다른 카드와 겹치면 가장 가까운 빈 자리로 옮긴다.
 * - 오른쪽 클릭 메뉴(빈 곳·카드·선, 키보드는 ContextMenu 키·Shift+F10, 터치는 카드 길게 누르기), 카드 좌·우 점에서 끌어 잇기, 카드 더블클릭 = 정보 편집, 선 클릭·Enter = 편집, 선 Delete = 삭제, 선 가운데의 편집·삭제 버튼(마우스를 올린 선 하나).
 * - 빈 캔버스에 초점이 있을 때(눌러서 초점을 줄 수 있고 Tab 순서에는 끼지 않는다) Tab은 `+ 설정 추가` 패널을 연다. 카드·선의 Tab은 평소대로 다음 요소로 간다.
 * - 성능: 카드·선은 memo하고 내용이 같으면 같은 객체를 React Flow에 준다(카드 하나를 끌면 그 카드와 닿은 선만 다시 그린다). hover·초점은 저장소라 Canvas를 다시 그리지 않는다. 카드가 40장 이상이면 화면 밖 카드는 그리지 않는다.
 *   카드·선의 키·초점은 캔버스 상자 하나가 받는다(위임): 노드마다 핸들러 객체를 새로 만들지 않는다.
 * 첫 화면: 이어지지 않은 카드도 무리 가장자리에 놓이므로(`forceLayout`) 전체 맞춤이 무리를 가운데에 놓는다. 멀리서는 관계 상위 8~12개 카드의 이름을 붙이고 겹치면 작은 노드부터 숨긴다(점은 가려도 된다).
 * 선 위 관계 이름은 모든 단계에서 기본 숨김이고, 선에 마우스를 올리거나 키보드 초점이 간 선·고른(관계 작성 중인) 선에만 그린다. 나머지 선은 <title> 툴팁·누르는 영역의 이름(aria)으로만 읽힌다(겹친 선의 이름이 서로 가리지 않게).
 * 층: 간선(React Flow 간선 층) < 카드 < 이름표 층(화면 좌표 div, 컨트롤 아래). 캔버스 높이는 CSS가 정하고, 이 컴포넌트는 캔버스 위쪽의 문서 위치만 `--rf-top`으로 알린다(관계도 보기가 '화면 높이 − 위쪽'을 채운다. 상자가 보일 때·창 크기·단계가 바뀔 때·위 줄의 크기가 바뀔 때만 잰다).
 */
export default function CharacterCards(props: CanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}

function Canvas({ vm, editing, find, toolsSlot }: CanvasProps) {
  const rf = useReactFlow()
  const rfRef = useRef(rf)
  rfRef.current = rf
  const host = useRef<HTMLDivElement>(null)
  const live = useRef(editing)
  live.current = editing
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
  // hot: 마우스를 올리거나 초점을 둔 선. 강조 카드는 출처마다 따로 둔다: hover(마우스), focused(키보드 초점), pinned(누른 고정). 마우스를 벗어나면 키보드 초점이나 고정으로 저절로 돌아간다.
  const [hot] = useState(() => createStore('')), [hover] = useState(() => createStore('')), [focused] = useState(() => createStore('')), [pinned] = useState(() => createStore(''))
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
  // 캔버스 위쪽의 문서 위치를 CSS에 알린다(캔버스 높이 = 화면 높이 − 이 값). 레이아웃을 강제하므로 렌더마다 하지 않고 상자가 보일 때·단계가 바뀔 때·창 크기가 바뀔 때·위 줄의 크기가 바뀔 때만 잰다.
  const measure = useCallback(() => { const el = host.current; if (el) el.style.setProperty('--rf-top', Math.round(el.getBoundingClientRect().top + window.scrollY) + 'px') }, [])
  useLayoutEffect(() => { measure() }, [measure, level, sized])
  useEffect(() => {
    window.addEventListener('resize', measure)
    // 위 한 줄(유형 필터·설정 찾기·알림)과 그 위의 줄(관계 기준 회차 등)의 높이가 바뀌면(줄바꿈·알림) 캔버스의 위쪽 위치도 바뀐다.
    const section = host.current?.closest('.relationship-editor'), watch = new Set<Element>()
    for (let el = section?.previousElementSibling; el; el = el.previousElementSibling) watch.add(el)
    const bar = section?.querySelector('.relationship-bar')
    if (bar) watch.add(bar)
    const observer = typeof ResizeObserver === 'undefined' || !watch.size ? null : new ResizeObserver(measure)
    watch.forEach((el) => observer?.observe(el))
    return () => { window.removeEventListener('resize', measure); observer?.disconnect() }
  }, [measure])

  /**
   * 모든 카드가 상자 안에 들어오게 하는 뷰포트(이미 아는 카드 경계와 상자 크기로 직접 계산한다: 속성에 맡기면 상자 크기를 알기 전에 0×0으로 맞춘다). 카드가 없거나 상자가 없으면 null이다.
   * `withPanel`이면 오른쪽에 + 설정 추가 패널 자리를 더 비운다(좁은 화면의 패널은 아래 시트라 비우지 않는다).
   */
  const fitViewport = (from: ReadonlyMap<string, Point>, withPanel = false): Viewport | null => {
    const el = host.current, list = nodesIn.map((n) => from.get(n.id)).filter(finite)
    if (!el || !list.length || !el.clientWidth || !el.clientHeight) return null
    const xs = list.map((p) => p.x), ys = list.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys)
    const padding = withPanel && el.clientWidth > 600 ? { ...FIT.padding, right: PANEL_W + 16 } : FIT.padding
    return getViewportForBounds({ x, y, width: Math.max(...xs) + CARD_W - x, height: Math.max(...ys) + CARD_H - y }, el.clientWidth, el.clientHeight, FIT.minZoom, FIT.maxZoom, padding)
  }
  const fitAll = (from: ReadonlyMap<string, Point> = positions, withPanel = panel) => { const view = fitViewport(from, withPanel); if (view) void rf.setViewport(view) }
  // 처음(상자가 보일 때마다)에는 전체 맞춤을 React Flow의 시작 뷰포트(defaultViewport)로 주고, 그 뷰포트가 실제로 적용된 것을 확인한 뒤에야 카드를 그린다:
  // 마운트 뒤에 setViewport를 부르면 개발 모드(StrictMode)가 줌 영역을 다시 만들며 기본 뷰포트(0,0,1배)로 되돌려 카드 수백 장을 가까이로 그렸다.
  const [start, setStart] = useState<Viewport | null>(null), [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    if (!sized) { setStart(null); setReady(false); return }
    measure() // 캔버스 높이가 이 값으로 정해지므로 상자 크기를 읽기 전에 먼저 잰다
    setStart(fitViewport(positions) ?? { x: 0, y: 0, zoom: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 상자가 보이게 될 때 한 번만 맞춘다
  }, [sized])
  useEffect(() => {
    if (!start) return
    const applied = () => { const [x, y, zoom] = viewportStore.getState().transform; return Math.abs(x - start.x) < 1 && Math.abs(y - start.y) < 1 && Math.abs(zoom - start.zoom) < 1e-6 }
    if (applied()) { setReady(true); return }
    return viewportStore.subscribe(() => { if (applied()) setReady(true) })
  }, [start, viewportStore])
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
  // 패널이 오른쪽을 덮는 동안(넓은 화면) 그 밑에 카드가 있으면 패널 자리를 비워 다시 맞춘다(카드가 패널에 가려지지 않게).
  const underPanel = () => {
    const el = host.current
    if (!el || el.clientWidth <= 600) return false
    const [tx, , k] = viewportStore.getState().transform, left = el.clientWidth - PANEL_W
    return nodesIn.some((n) => { const p = at(n.id); return !!p && tx + (cardCenter(p).x + CARD_W / 2) * k > left })
  }
  const openPanel = (from: HTMLElement | null) => { panelOpener.current = from; setMenu(null); setPanel(true); if (underPanel()) fitAll(positions, true) }
  /** 노드 하나의 상자(중심 + 어느 단계에서나 겹치지 않는 크기): 카드 위치는 같고 크기는 카드와 점 중 큰 쪽이다. */
  const bodyOf = (id: string, p: Point): Box => ({ cx: cardCenter(p).x, cy: cardCenter(p).y, ...bodyBox(dotDiameter(degree.get(id) ?? 0, maxDegree)) })
  /** 새 카드를 `center`(캔버스 좌표, 없으면 보이는 화면 가운데)를 가운데로 하는 가장 가까운 빈 자리(다른 노드와 간격 16px)에 놓는다. */
  const addAt = (type: CardType, center?: Point) => {
    const id = live.current.onAdd(type)
    if (!id) return
    const el = host.current
    const target = center ?? (el ? (() => { const r = el.getBoundingClientRect(); return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })() : { x: 0, y: 0 })
    const others = nodesIn.flatMap((n) => { const p = at(n.id); return p ? [bodyOf(n.id, p)] : [] })
    const spot = nearestFree({ cx: target.x, cy: target.y, ...bodyBox(dotDiameter(0, maxDegree)) }, others)
    pending.current.set(id, { x: spot.cx - CARD_W / 2, y: spot.cy - CARD_H / 2 })
    setPanel(false)
    setAdded({ id, seq: ++seq.current })
  }
  // 새 카드가 그래프에 나타나면 선택하고 가운데로 확대하며 초점을 준다(캔버스에 머문다: 편집 화면으로 가지 않는다).
  useEffect(() => {
    if (!added) return
    const p = positions.get(added.id)
    if (!p || !nodesIn.some((n) => n.id === added.id)) return
    setAdded(null)
    live.current.onMark(added.id)
    void focusOn(p, Math.max(rf.getZoom(), 1))
    host.current?.querySelector<HTMLElement>('[data-id="' + added.id + '"]')?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 새 카드가 생겼는지만 본다
  }, [added, positions, nodesIn])

  const names = new Map(nodesIn.map((n) => [n.id, n.name])), title = (id: string) => names.get(id) ?? '인물'
  const subject = nodesIn.some((n) => n.kind !== '인물') ? '설정' : '인물'
  const canDrag = !editing.busy && !editing.targetSource // 상대를 고르는 중에는 카드를 끌지 않고 누르기만 받는다
  const openMenu = useCallback((next: MenuState) => { setPanel(false); setMenu(next) }, [])
  // 키보드 초점이 간 카드(`card`: 노드 래퍼나 안쪽 카드, `center`: 카드 중심의 캔버스 좌표)가 캔버스 밖이면 그 카드가 가운데 오게 옮긴다. 배율은 그대로다.
  // React Flow의 노드 초점 자동 이동은 disableKeyboardA11y라 꺼져 있고, 카드 안 버튼의 초점은 원래 따라가지 않는다.
  const reveal = useCallback((card: HTMLElement, center: Point) => {
    const view = card.closest('.react-flow')?.getBoundingClientRect(), box = card.getBoundingClientRect()
    if (view && (box.left < view.left || box.right > view.right || box.top < view.top || box.bottom > view.bottom)) void rfRef.current.setCenter(center.x, center.y, { zoom: rfRef.current.getZoom() })
  }, [])
  const context = useMemo<Graph>(() => ({ live, marker, hot, hover, focused, pinned, openMenu, reveal, pressed, busy: editing.busy, source: editing.targetSource }), [marker, hot, hover, focused, pinned, openMenu, reveal, editing.busy, editing.targetSource])
  // 카드(노드 래퍼) 자체에 초점이 있을 때의 키: 래퍼마다 핸들러를 만들지 않고 캔버스 상자가 받는다(카드 안 버튼의 키는 그 버튼이 쓴다).
  const nodeKeyDown = (e: ReactKeyboardEvent<HTMLElement>, id: string, card: Element) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!editing.busy) editing.onSelect(id) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!editing.busy) editing.onDeleteCard(id) }
    else if (isMenuKey(e)) { e.preventDefault(); openMenu({ kind: 'node', id, ...centerOf(card) }) } // 메뉴는 캔버스 상자가 아니라 키를 받은 카드 자리에서 연다
  }
  const ids = nodesIn.map((n) => n.id), degree = degrees(ids, graphLinks), maxDegree = Math.max(0, ...degree.values())
  /** 카드 한 장이 지금 단계에서 차지하는 상자: 가까이서는 카드(200×150), 멀리·중간에서는 관계 수에 비례하는 점(중심은 같다). */
  const box = (id: string) => level === 'near' ? { w: CARD_W, h: CARD_H } : { w: dotDiameter(degree.get(id) ?? 0, maxDegree), h: dotDiameter(degree.get(id) ?? 0, maxDegree) }
  const nodes = useStableList<FlowCard>(nodesIn.map((n) => {
    const selected = vm.selected?.id === n.id, p = at(n.id), center = p ? cardCenter(p) : { x: 0, y: 0 }, { w, h } = box(n.id)
    return {
      id: n.id, type: 'card', position: { x: center.x - w / 2, y: center.y - h / 2 }, width: w, height: h, measured: { width: w, height: h }, handles: HANDLES, draggable: canDrag,
      ariaRole: 'group', ariaLabel: n.name + ' ' + n.kind + ' 카드', domAttributes: { 'aria-current': selected || undefined, 'aria-roledescription': '카드' },
      data: { n, selected, target: !!editing.targetSource && n.id !== editing.targetSource, dim: !vm.visible.has(n.id), level, center },
    }
  }))
  const edges = useStableList<FlowRelation>(vm.graph.links.flatMap((l, i) => {
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
  }))
  // 이름표 층이 쓰는 노드(캔버스 좌표): 내용이 같으면 같은 객체라 배치·단계가 바뀔 때만 이름표 층이 다시 그려진다.
  const labelNodes = useStableList<NameNode>(nodesIn.flatMap((n) => { const p = at(n.id); return p ? [{ id: n.id, cx: cardCenter(p).x, cy: cardCenter(p).y, d: dotDiameter(degree.get(n.id) ?? 0, maxDegree), name: n.name, degree: degree.get(n.id) ?? 0, dim: !vm.visible.has(n.id) }] : [] }))
  // 카드 본문을 누를 때: 카드 안 버튼의 누르기는 제외한다. 끌고 놓은 직후의 click은 React Flow가 막아 여기까지 오지 않는다(`preventNextClick`). 길게 눌러 메뉴를 연 뒤의 click도 건너뛴다.
  const onNodeClick = useEvent((event: ReactMouseEvent, node: Node) => {
    if (pressed.current) { pressed.current = false; return }
    if (editing.busy || (event.target instanceof Element && event.target.closest('button'))) return
    if (!editing.targetSource) pinned.set(pinned.get() === node.id ? '' : node.id) // 누르면 강조를 고정하고, 같은 카드를 다시 누르면 푼다(연결 상대를 고르는 중에는 하지 않는다)
    const p = at(node.id)
    if (level === 'far' && p && !editing.targetSource) { editing.onMark(node.id); void focusOn(p, ZOOM_TO_NODE); return } // 멀리서 점을 누르면 그 카드로 다가간다(상대를 고르는 중에는 상대로 고른다)
    editing.onPick(node.id)
  })
  // 13.0.2의 변경 묶음은 배열이 아니라 `NodeChangeset`이다. 쓰는 것은 끌어 옮긴 위치(position)뿐이다.
  const onNodesChange = useEvent<[Parameters<OnNodesChange<FlowCard>>[0]], void>((changes) => {
    // 끈 상자의 왼쪽 위(position)를 카드 기준 자리(카드의 왼쪽 위)로 되돌려 저장한다: 점 단계에서는 상자가 점이다.
    const moved = changes.getByType('position').flatMap((c) => { if (!finite(c.position)) return []; const { w, h } = box(c.id); return [[c.id, { x: c.position.x + w / 2 - CARD_W / 2, y: c.position.y + h / 2 - CARD_H / 2 }] as [string, Point]] })
    if (moved.length) setPositions((old) => { const next = new Map(old); for (const [id, position] of moved) next.set(id, position); return next })
  })
  // 빈 캔버스를 누르면 고정한 강조를 푼다.
  const onPaneClick = useEvent(() => pinned.set(''))
  // 끌어 놓은 카드가 다른 노드와 겹치면(간격 16px 안) 가장 가까운 빈 자리로 옮긴다. 끄는 동안에는 자유롭게 움직인다.
  const onNodeDragStop = useEvent((_: unknown, node: Node) => {
    const { w, h } = box(node.id), want: Box = { cx: node.position.x + w / 2, cy: node.position.y + h / 2, ...bodyBox(dotDiameter(degree.get(node.id) ?? 0, maxDegree)) }
    const others = nodesIn.flatMap((n) => { const p = n.id === node.id ? undefined : at(n.id); return p ? [bodyOf(n.id, p)] : [] })
    const spot = nearestFree(want, others)
    if (spot.cx !== want.cx || spot.cy !== want.cy) setPositions((old) => new Map(old).set(node.id, { x: spot.cx - CARD_W / 2, y: spot.cy - CARD_H / 2 }))
  })
  const unnamed = new Map(nodesIn.map((n) => [n.id, n]))
  const isValidConnection = useEvent((c: Edge | Connection) => !editing.busy && !editing.targetSource && validConnection({ source: c.source, target: c.target }, unnamed))
  const onConnect = useEvent((c: Connection) => { if (isValidConnection(c)) editing.onPair(c.source, c.target) })
  const onNodeDoubleClick = useEvent((_: ReactMouseEvent, node: Node) => { if (!editing.busy) editing.onSelect(node.id) })
  const onPaneContextMenu = useEvent((e: ReactMouseEvent | MouseEvent) => { e.preventDefault(); openMenu({ kind: 'pane', x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) }) })
  const onNodeContextMenu = useEvent((e: ReactMouseEvent, node: Node) => { e.preventDefault(); openMenu({ kind: 'node', id: node.id, x: e.clientX, y: e.clientY }) })
  const onEdgeContextMenu = useEvent((e: ReactMouseEvent, edge: Edge) => { e.preventDefault(); const relationId = (edge as FlowRelation).data?.relationId; if (relationId) openMenu({ kind: 'edge', relationId, x: e.clientX, y: e.clientY }) })

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
  // 도구 막대: 편집기가 만든 캔버스 위 한 줄(유형 필터·설정 찾기와 같은 줄)에 그린다. 캔버스를 가리지 않아 맞춤 여백이 위를 비울 필요가 없다. 캔버스 밖이라 캔버스 상자의 키·초점 처리(위임)가 이 버튼들로 오지 않는다.
  const tools = (
    <div className="relationship-tools" role="toolbar" aria-label="관계도 도구">
      <button type="button" className="btn sm" aria-haspopup="dialog" aria-expanded={panel} onClick={(e) => { if (panel) closePanel(); else openPanel(e.currentTarget) }}>+ 설정 추가</button>
      <button type="button" className="btn sm" onClick={relayout}>배치 정돈</button>
      <button type="button" className="btn sm" onClick={() => fitAll()}>화면 맞춤</button>
    </div>
  )
  return (
    <>
    {toolsSlot && createPortal(tools, toolsSlot)}
    <div
      ref={host} className="relationship-flow" data-level={level} role="group" aria-label={subject + ' 카드 그래프'} tabIndex={-1}
      onKeyDown={(e) => {
        const target = e.target as Element
        if (e.key === 'Escape' && pinned.get()) { pinned.set(''); return } // 고정한 강조를 푼다(메뉴·패널은 Esc를 스스로 받고 전파하지 않는다)
        if (target === e.currentTarget) { // 캔버스 자체에 초점이 있을 때(카드·선·버튼·입력칸의 키는 그쪽이 쓴다)
          if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openPanel(e.currentTarget) }
          else if (isMenuKey(e)) { e.preventDefault(); const c = centerOf(e.currentTarget); openMenu({ kind: 'pane', ...c, flow: rf.screenToFlowPosition(c) }) }
          return
        }
        const id = target.classList.contains('react-flow__node') ? target.getAttribute('data-id') : null // 카드 래퍼 자체일 때만(안쪽 버튼의 키는 제외)
        if (id) nodeKeyDown(e, id, target)
      }}
      onFocus={(e) => { // 카드(또는 그 안 버튼)에 키보드 초점이 가면 마우스를 올린 것처럼 강조하고(마우스로 눌러 간 초점은 아니다: 그러면 고정을 푸는 두 번째 누르기가 보이지 않는다), 카드 래퍼 자체면 화면 밖일 때 가운데로 옮긴다
        const target = e.target as HTMLElement, id = nodeIdOf(target)
        if (id && target.matches(':focus-visible')) focused.set(id)
        const p = target.classList.contains('react-flow__node') && id ? at(id) : undefined
        if (p) reveal(target, cardCenter(p))
      }}
      onBlur={(e) => { const id = nodeIdOf(e.target); if (id && nodeIdOf(e.relatedTarget) !== id) focused.set('') }}
      onMouseOver={(e) => { const id = nodeIdOf(e.target); if (id) hover.set(id) }}
      onMouseOut={(e) => { const id = nodeIdOf(e.target); if (id && nodeIdOf(e.relatedTarget) !== id) hover.set('') }}
    >
      <svg className="relationship-marker-defs" aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge,var(--pri-ink))" /></marker></defs></svg>
      {start && <GraphContext.Provider value={context}>
        {/* 카드는 선택·삭제·방향키 이동을 React Flow에 맡기지 않고(우리 쪽 키·메뉴가 한다) 초점은 받는다. disableKeyboardA11y는 노드의 영어 키보드 안내(aria-describedby)를 걷고, panActivationKeyCode·deleteKeyCode의 null은 Space·Backspace를 document에서 가로채는 기본 단축키를 꺼서 Space로 페이지를 내릴 수 있게 한다. */}
        <ReactFlow
          nodes={ready ? nodes : NO_NODES} edges={ready ? edges : NO_EDGES} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultViewport={start} onlyRenderVisibleElements={nodesIn.length >= VISIBLE_ONLY_FROM}
          onNodesChange={onNodesChange} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onPaneClick={onPaneClick} onNodeDragStop={onNodeDragStop}
          onPaneContextMenu={onPaneContextMenu} onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu}
          onConnect={onConnect} isValidConnection={isValidConnection} connectionRadius={130}
          nodeDragThreshold={4} nodesConnectable elementsSelectable={false} edgesFocusable={false} disableKeyboardA11y deleteKeyCode={null} panActivationKeyCode={null} zoomOnDoubleClick={false}
          minZoom={FIT.minZoom} maxZoom={1.75} forceColorMode="dark" ariaLabelConfig={ARIA}
        >
          {ready && <LabelLayer nodes={labelNodes} edges={edges} level={level} selected={vm.selected?.id ?? ''} />}
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />
          <Controls showInteractive={false} showFitView={false}>
            <ControlButton onClick={() => fitAll()} title={ARIA['controls.fitView.ariaLabel']} aria-label={ARIA['controls.fitView.ariaLabel']}><FitIcon /></ControlButton>
          </Controls>
        </ReactFlow>
        {ready && <FocusStyle nodes={labelNodes} edges={edges} />}
      </GraphContext.Provider>}
      {panel && <AddCardPanel busy={editing.busy} onAdd={(type) => addAt(type)} onClose={closePanel} />}
      {menu && <RelationContextMenu key={menu.kind + ':' + menu.x + ':' + menu.y} label={menuLabel(menu)} x={menu.x} y={menu.y} entries={menuEntries(menu)} onClose={() => setMenu(null)} />}
    </div>
    </>
  )
}
