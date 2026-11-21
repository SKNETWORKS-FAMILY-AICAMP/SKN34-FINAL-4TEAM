import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { cardTypes, type CardType } from '../../../../domain/entities/studioCards'
import { aspectGravity } from '../../worlds/worldAtlas'
import { DEFAULT_SETTINGS, forceParams, labelBox, labelCollide, type GraphSettings } from '../viewmodel/graphForces'
import { buildGraph, endId, labelLimit, relationTitle, topDegreeIds, type GLink, type GNode } from '../viewmodel/graphModel'
import { neighborhood } from '../viewmodel/highlight'
import type { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import { AddCardPanel } from './AddCardPanel'
import { GraphKeyboardList } from './GraphKeyboardList'
import { GraphSettingsPanel, type Filters } from './GraphSettingsPanel'
import { arrowLength, arrowPos, hitAt, hitRadius, labelPlan, linkColor, linkWidth, paintLabels, paintLinkLabels, paintNode, type PaintState } from './graphPaint'
import { centerOf, isMenuKey } from './menuKey'
import { RelationContextMenu, type MenuEntry } from './RelationContextMenu'

/**
 * 캔버스가 편집기에 거는 동작. 노드를 누르면(`onPick`) 선택, 연결 모드(`targetSource`)에서는 상대 고르기다. `onMark`는 새로 만든 설정을 부작용 없이 선택만 한다.
 * `onAdd`는 초안에 설정을 더하고 그 id를 돌려준다(처리 중이면 안 준다). 삭제(`onDeleteCard`·`onDeleteRelation`)는 확인을 거치는 쪽이 정한다. `deleteLock`은 카드 삭제를 막는 이유('' = 삭제할 수 있다).
 */
export type Actions = {
  busy: boolean; selectedRelations: string[]; targetSource: string | null; deleteLock: string
  onPick: (id: string) => void; onSelect: (id: string) => void; onConnect: (id: string) => void
  onRelation: (id: string) => void; onDeleteCard: (id: string) => void; onDeleteRelation: (id: string) => void; onAdd: (type: CardType) => string | undefined; onMark: (id: string) => void
}
type Point = { x: number; y: number }
/** 열린 오른쪽 클릭 메뉴: 빈 곳(`at` = 누른 자리의 그래프 좌표)·노드·선(쌍의 선 id). `x`·`y`는 화면 좌표다. */
type MenuState = Point & ({ kind: 'pane'; at: Point } | { kind: 'node'; id: string } | { kind: 'link'; id: string })

/** 맞춤 여백(px): 위의 + 설정 추가·톱니 버튼과 노드 아래 이름표가 잘리지 않을 만큼이다. */
const FIT_PADDING = 64
/** 설정을 찾거나 새로 만들어 다가갈 때의 최소 확대 배율(이미 더 확대돼 있으면 줄이지 않는다). */
const FOCUS_ZOOM = 1.5
/** 같은 노드를 이 시간(ms) 안에 다시 누르면 더블클릭(정보 편집)이다. */
const DOUBLE_CLICK_MS = 400
/** 길게 누르기(터치)로 메뉴를 여는 시간과 그 사이 허용하는 움직임(px). */
const LONG_PRESS_MS = 600, LONG_PRESS_MOVE = 10

const GearIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>

type Props = { vm: Pick<ReturnType<typeof useWorldMapViewModel>, 'graph' | 'selected' | 'visible'>; editing: Actions; find?: { id: string; seq: number } | null; filters: Filters }

/**
 * 관계도 그래프(react-force-graph-2d 캔버스, 옵시디언 그래프 뷰처럼): 모든 배율에서 점과 이름뿐이다. 점은 이어진 관계 수의 제곱근에 비례하는 채운 원(유형 색), 선은 가는 회색 직선(같은 두 설정 사이의 관계는 선 하나), 배경은 평평하다.
 * - 배치: 힘 시뮬레이션이 실시간으로 돈다(끄는 노드를 이웃이 따라오고 놓으면 고정이 풀린다, 식으면 멈춘다). 중심·반발·연결 힘과 이름표 포함 겹침 방지(`labelCollide`)는 설정 패널의 슬라이더로 바꾼다. 좌표는 화면 상태일 뿐 저장하지 않는다.
 * - 이름: 노드 바로 아래 화면 12px 이상의 글자로 어느 배율에서나 그린다(`graphPaint`). 임계값보다 멀리 가면 관계가 많은 몇 개의 이름만 남고 겹치면 작은 노드부터 숨는다. 선 위 관계 이름은 올리거나 고른 선에만 보인다.
 * - 강조: 올린 노드(없으면 키보드 초점, 없으면 눌러 고정한 노드)와 그 이웃·닿는 선만 또렷하고 나머지는 흐리다. 노드를 누르면 고정하고 같은 노드를 다시 누르거나 빈 곳·Esc로 푼다.
 * - 조작: 휠로 커서 자리 확대·빈 곳 끌기로 이동·노드 끌기, 노드 더블클릭 = 정보 편집, 선 클릭 = 관계 편집 시트, 오른쪽 클릭 메뉴(빈 곳·노드·선: `RelationContextMenu`), 터치는 길게 누르기가 메뉴·핀치가 확대다. 키보드는 `GraphKeyboardList`가 같은 일을 한다.
 * - 도구: 왼쪽 위 + 설정 추가(`AddCardPanel`), 오른쪽 위 톱니(`GraphSettingsPanel`). 새 설정은 누른 자리(패널은 화면 가운데)에서 물리에 합류하고 선택·강조한다.
 * 상자가 숨겨져(크기 0) 있으면 그리지 않고(관계 편집기는 다른 화면에서도 숨은 채 마운트돼 있다) 보이면 처음처럼 전체를 맞춘다: 첫 틱에 곧바로, 배치가 처음 멈출 때 한 번 더(그 사이 사용자가 움직였으면 그대로 둔다).
 * 캔버스 높이는 CSS가 정하고, 이 컴포넌트는 캔버스 위쪽의 문서 위치만 `--rf-top`으로 알린다(관리 모드 관계도 보기가 '화면 높이 − 위쪽'을 채운다).
 */
export default function RelationGraph({ vm, editing, find, filters }: Props) {
  const host = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null), gear = useRef<HTMLButtonElement>(null), addOpener = useRef<HTMLElement | null>(null)
  const graph = useRef<ForceGraphMethods<GNode, GLink>>(undefined)
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const ms = (duration: number) => (reduced ? 0 : duration)
  const panelId = useId()
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS)
  const change = <K extends keyof GraphSettings>(key: K, value: GraphSettings[K]) => setSettings((old) => ({ ...old, [key]: value }))
  const [hover, setHover] = useState(''), [focusNode, setFocusNode] = useState(''), [focusLink, setFocusLink] = useState(''), [pin, setPin] = useState(''), [hotLink, setHotLink] = useState('')
  const [panel, setPanel] = useState(false), [adding, setAdding] = useState(false), [menu, setMenu] = useState<MenuState | null>(null), [added, setAdded] = useState<{ id: string; seq: number } | null>(null)
  const seq = useRef(0), zoom = useRef(1)

  // 상자 크기: 0이면(숨겨져 있으면) 그래프를 그리지 않는다.
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = surface.current
    if (!el) return
    const update = () => setBox((old) => (old.w === el.clientWidth && old.h === el.clientHeight ? old : { w: el.clientWidth, h: el.clientHeight }))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const sized = box.w > 0 && box.h > 0
  const boxNow = useRef(box)
  boxNow.current = box
  // 캔버스 위쪽의 문서 위치를 CSS에 알린다(캔버스 높이 = 화면 높이 − 이 값). 레이아웃을 강제하므로 렌더마다 하지 않고 상자가 보일 때·창 크기가 바뀔 때·위 줄의 크기가 바뀔 때만 잰다.
  const measure = () => { const el = host.current; if (el) el.style.setProperty('--rf-top', Math.round(el.getBoundingClientRect().top + window.scrollY) + 'px') }
  useLayoutEffect(measure, [sized])
  useEffect(() => {
    window.addEventListener('resize', measure)
    // 캔버스 위의 줄(관계 기준 회차·알림)의 높이가 바뀌면(줄바꿈·알림) 캔버스의 위쪽 위치도 바뀐다.
    const section = host.current?.closest('.relationship-editor'), watch = new Set<Element>()
    for (let el = section?.previousElementSibling; el; el = el.previousElementSibling) watch.add(el)
    const bar = section?.querySelector('.relationship-bar')
    if (bar) watch.add(bar)
    const observer = typeof ResizeObserver === 'undefined' || !watch.size ? null : new ResizeObserver(measure)
    watch.forEach((el) => observer?.observe(el))
    return () => { window.removeEventListener('resize', measure); observer?.disconnect() }
  }, [])

  // 그래프 데이터: 설정이 바뀌어 다시 만들어도 같은 설정은 같은 객체(좌표를 잇는다). 올리기·고정 같은 화면 상태가 바뀔 때는 같은 객체여야 한다(바뀌면 시뮬레이션이 처음부터 다시 돈다).
  const store = useRef(new Map<string, GNode>()), spawn = useRef(new Map<string, Point>())
  const model = useMemo(() => {
    const built = buildGraph(vm.graph.nodes, vm.graph.links, store.current, spawn.current)
    store.current = new Map(built.nodes.map((n) => [n.id, n]))
    return built
  }, [vm.graph])
  const graphData = useMemo(() => ({ nodes: settings.orphans ? model.nodes : model.nodes.filter((n) => n.degree > 0), links: model.links }), [model, settings.orphans])
  const nodes = graphData.nodes
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const pairs = useMemo(() => graphData.links.map((l) => ({ id: l.id, source: endId(l.source), target: endId(l.target) })), [graphData])
  const top = useMemo(() => topDegreeIds(nodes.map((n) => n.id), new Map(nodes.map((n) => [n.id, n.degree])), labelLimit(nodes.length)), [nodes])
  const relationPair = useMemo(() => new Map(graphData.links.flatMap((l) => l.relations.flatMap((r) => (r.id ? [[r.id, l.id] as const] : [])))), [graphData])
  const picked = new Set(editing.selectedRelations.flatMap((id) => relationPair.get(id) ?? []))
  const relationCount = graphData.links.reduce((sum, l) => sum + l.relations.length, 0)
  const title = (id: string) => byId.get(id)?.name ?? '설정'

  // 강조: 올린 노드 > 키보드 초점 > 고정한 노드.
  const activeId = hover || focusNode || pin
  const around = useMemo(() => (activeId && byId.has(activeId) ? { id: activeId, ...neighborhood(activeId, pairs) } : null), [activeId, byId, pairs])
  const paint: PaintState = { settings, around, visible: vm.visible, selected: vm.selected?.id ?? '', connecting: editing.targetSource, hotLink: hotLink || focusLink, pickedLinks: picked, top, maxDegree: model.maxDegree }

  // 힘: 중심·반발·연결 힘은 슬라이더 값으로, 중력(가로세로비)과 이름표 포함 겹침 방지는 우리 힘이다. 값이 바뀌면 시뮬레이션을 다시 데운다(처음 그릴 때는 이미 돌고 있다).
  const nodeSize = useRef(settings.nodeSize)
  nodeSize.current = settings.nodeSize
  const forced = useRef(false)
  useLayoutEffect(() => {
    const g = graph.current
    if (!g) return
    const { gravity, charge, linkStrength, linkDistance } = forceParams(settings)
    g.d3Force('charge')?.strength(charge)
    g.d3Force('link')?.distance(linkDistance).strength(linkStrength)
    g.d3Force('gravity', aspectGravity<GNode>(() => boxNow.current.w / (boxNow.current.h || 1), gravity))
    g.d3Force('collide', labelCollide<GNode>((n) => labelBox(n.name, n.r * nodeSize.current)))
    if (forced.current) g.d3ReheatSimulation()
    forced.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 슬라이더 값이 바뀔 때만 다시 정한다
  }, [sized, settings.center, settings.repel, settings.linkForce, settings.linkDistance, settings.nodeSize])

  // 맞춤: 상자가 보이면 처음처럼(첫 틱에 곧바로, 배치가 처음 멈출 때 한 번 더). 그 사이 사용자가 휠·눌러 움직였으면(touched) 그대로 둔다.
  const flags = useRef({ early: false, final: false, touched: false })
  const refit = () => { flags.current = { early: false, final: false, touched: false } }
  useEffect(() => { if (sized) refit() }, [sized])
  const fit = (duration: number) => graph.current?.zoomToFit(duration, FIT_PADDING)
  const focusOn = (n: GNode) => {
    const g = graph.current
    if (!g || n.x === undefined || n.y === undefined) return
    flags.current.touched = true
    g.centerAt(n.x, n.y, ms(400))
    g.zoom(Math.max(g.zoom(), FOCUS_ZOOM), ms(400))
  }
  const relayout = () => {
    nodes.forEach((n, i) => { // 중심 근처 나선에서 다시 펼친다(d3의 처음 배치와 같은 나선)
      const r = 10 * Math.sqrt(0.5 + i), angle = i * Math.PI * (3 - Math.sqrt(5))
      Object.assign(n, { x: r * Math.cos(angle), y: r * Math.sin(angle), vx: 0, vy: 0, fx: undefined, fy: undefined })
    })
    refit()
    graph.current?.d3ReheatSimulation()
  }

  // 설정 찾기(편집기가 id와 요청 번호를 준다): 그 노드가 가운데에 오게 옮기고 확대는 줄이지 않는다.
  const findSeq = find?.seq
  useEffect(() => {
    const n = find && byId.get(find.id)
    if (n) focusOn(n)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 요청 번호가 바뀔 때만 움직인다
  }, [findSeq])
  // 새 설정이 그래프에 나타나면 선택·고정하고 다가간다(캔버스에 머문다: 편집 화면으로 가지 않는다).
  useEffect(() => {
    const n = added && byId.get(added.id)
    if (!added || !n) return
    setAdded(null)
    editing.onMark(added.id)
    setPin(added.id)
    focusOn(n)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 새 설정이 생겼는지만 본다
  }, [added, byId])

  /** 화면(client) 좌표를 그래프 좌표로: 클릭·길게 누르기·메뉴 키가 준 좌표용이다. */
  const toGraph = (x: number, y: number) => { const r = surface.current?.getBoundingClientRect(); return graph.current?.screen2GraphCoords(x - (r?.left ?? 0), y - (r?.top ?? 0)) ?? { x: 0, y: 0 } }
  /** 캔버스 상자 안 좌표(상자 왼쪽 위가 원점)를 그래프 좌표로. */
  const fromSurface = (x: number, y: number) => graph.current?.screen2GraphCoords(x, y) ?? { x: 0, y: 0 }
  /** 새 설정을 `at`(그래프 좌표, 없으면 화면 가운데)에서 시작하게 더한다. */
  const addAt = (type: CardType, at?: Point) => {
    const id = editing.onAdd(type)
    if (!id) return
    spawn.current.set(id, at ?? fromSurface(box.w / 2, box.h / 2))
    if (!settings.orphans) change('orphans', true) // 새 설정은 관계가 0이라 외톨이다: 숨겨 두면 보이지도 선택되지도 않는다
    setAdding(false)
    setAdded({ id, seq: ++seq.current })
  }
  /** 설정 패널을 닫는다: 패널에서 쓰던 설정 찾기 글도 지운다(패널이 닫힌 채 흐려진 노드만 남지 않게). */
  const shutPanel = () => { if (!panel) return; setPanel(false); filters.onTyped('') }
  const openMenu = (next: MenuState) => { setAdding(false); setMenu(next) }
  /** 마우스·터치로 연 메뉴: 닫을 때 초점이 돌아갈 곳으로 캔버스 상자를 먼저 잡는다(캔버스는 눌러도 초점을 받지 않는다). 키보드로 연 메뉴는 초점을 그대로 둔다. */
  const pointerMenu = (next: MenuState) => { host.current?.focus({ preventScroll: true }); openMenu(next) }
  const closePanel = () => { shutPanel(); gear.current?.focus() }
  const closeAdd = () => { setAdding(false); const back = addOpener.current; if (back?.isConnected) back.focus() }

  // 노드·선·빈 곳 누르기. 길게 눌러 메뉴를 연 뒤 손가락을 뗄 때 오는 click은 건너뛴다(`pressed`).
  const pressed = useRef(false), lastClick = useRef({ id: '', at: 0 })
  const forget = () => { lastClick.current = { id: '', at: 0 } }
  const swallowed = () => { if (!pressed.current) return false; pressed.current = false; return true }
  const onNodeClick = (node: GNode) => {
    host.current?.focus({ preventScroll: true })
    if (swallowed() || editing.busy) return
    const now = Date.now(), last = lastClick.current
    if (!editing.targetSource && last.id === node.id && now - last.at < DOUBLE_CLICK_MS) { forget(); editing.onSelect(node.id); return } // 더블클릭: 정보 편집(강조 고정은 첫 누르기 그대로)
    lastClick.current = { id: node.id, at: now }
    if (!editing.targetSource) setPin((old) => (old === node.id ? '' : node.id)) // 누르면 고정하고 다시 누르면 푼다(연결 상대를 고르는 중에는 고정하지 않는다)
    editing.onPick(node.id)
  }
  const onLinkClick = (link: GLink) => {
    host.current?.focus({ preventScroll: true })
    const id = link.relations[0]?.id
    if (!swallowed() && id && !editing.busy) editing.onRelation(id)
  }
  const onBackgroundClick = () => { host.current?.focus({ preventScroll: true }); if (swallowed()) return; forget(); setPin('') }

  // 터치의 길게 누르기: 누른 자리의 노드·선(없으면 빈 곳) 메뉴. 손가락에는 오른쪽 클릭이 없다.
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const cancelPress = () => { if (press.current) { window.clearTimeout(press.current.timer); press.current = null } }
  useEffect(() => cancelPress, [])
  const longPress = (x: number, y: number) => {
    const at = toGraph(x, y), hit = hitAt(nodes, graphData.links, at.x, at.y, graph.current?.zoom() ?? 1, paint)
    pressed.current = true
    pointerMenu(hit ? { kind: hit.kind, id: hit.id, x, y } : { kind: 'pane', at, x, y })
  }
  const onPointerDown = (e: ReactPointerEvent) => {
    pressed.current = false
    if (e.pointerType !== 'touch') return
    cancelPress()
    const { clientX: x, clientY: y } = e
    press.current = { x, y, timer: window.setTimeout(() => { press.current = null; longPress(x, y) }, LONG_PRESS_MS) }
  }
  const onPointerMove = (e: ReactPointerEvent) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_MOVE) cancelPress() }

  const removeHotRelation = () => { // 마우스를 올린 선에서 Delete: 관계가 하나일 때만(여럿이면 어느 관계인지 알 수 없다)
    const link = graphData.links.find((l) => l.id === hotLink), id = link?.relations.length === 1 ? link.relations[0].id : undefined
    if (id && !editing.busy) editing.onDeleteRelation(id)
  }
  const menuEntries = (m: MenuState): MenuEntry[] => {
    if (m.kind === 'pane') return [
      { label: '여기에 설정 추가', items: cardTypes.map((t) => ({ label: t.label, disabled: editing.busy, onSelect: () => addAt(t.id, m.at) })) },
      { label: '배치 정돈', onSelect: relayout },
      { label: '화면 맞춤', onSelect: () => fit(ms(400)) },
    ]
    if (m.kind === 'node') {
      const n = byId.get(m.id)
      return [
        { label: '정보 편집', disabled: editing.busy, onSelect: () => editing.onSelect(m.id) },
        { label: '관계 연결', disabled: editing.busy || !n || n.unnamed, onSelect: () => editing.onConnect(m.id) },
        { label: '삭제', disabled: editing.busy || !!editing.deleteLock, reason: editing.deleteLock || undefined, onSelect: () => editing.onDeleteCard(m.id) },
      ]
    }
    const relations = (graphData.links.find((l) => l.id === m.id)?.relations ?? []).filter((r) => r.id)
    return [
      { label: '관계 편집', disabled: editing.busy || !relations.length, onSelect: () => editing.onRelation(relations[0].id!) },
      relations.length === 1
        ? { label: '관계 삭제', disabled: editing.busy, onSelect: () => editing.onDeleteRelation(relations[0].id!) }
        : { label: '관계 삭제', items: relations.map((r) => ({ label: relationTitle(r, title), disabled: editing.busy, onSelect: () => editing.onDeleteRelation(r.id!) })) },
    ]
  }
  const menuLabel = (m: MenuState) => (m.kind === 'pane' ? '캔버스 메뉴' : m.kind === 'node' ? title(m.id) + ' 메뉴' : '관계선 메뉴')

  const onRenderFramePost = (ctx: CanvasRenderingContext2D, k: number) => {
    const g = graph.current
    if (!g) return
    const origin = g.graph2ScreenCoords(0, 0), view = { x: origin.x, y: origin.y, k, w: box.w, h: box.h }
    paintLinkLabels(ctx, graphData.links, k, paint)
    paintLabels(ctx, labelPlan(nodes, view, paint), view, byId)
  }

  return (
    <div
      ref={host} className={'relationship-flow' + (editing.targetSource ? ' connecting' : '')} tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && pin) { forget(); setPin(''); return } // 고정한 강조를 푼다(메뉴·패널은 Esc를 스스로 받고 전파하지 않는다)
        if (e.target !== e.currentTarget) return // 캔버스 자체에 초점이 있을 때(버튼·목록·입력칸의 키는 그쪽이 쓴다)
        if (isMenuKey(e)) { e.preventDefault(); const c = centerOf(e.currentTarget); openMenu({ kind: 'pane', ...c, at: toGraph(c.x, c.y) }) }
        else if (e.key === 'Delete' || e.key === 'Backspace') removeHotRelation()
      }}
    >
      <button type="button" className="btn sm relationship-add-button" aria-haspopup="dialog" aria-expanded={adding} onClick={(e) => { if (adding) closeAdd(); else { addOpener.current = e.currentTarget; setMenu(null); shutPanel(); setAdding(true) } }}>+ 설정 추가</button>
      <button ref={gear} type="button" className="btn sm relationship-gear" aria-label="그래프 설정" aria-expanded={panel} aria-controls={panel ? panelId : undefined} onKeyDown={(e) => { if (e.key === 'Escape' && panel) { e.stopPropagation(); closePanel() } }} onClick={() => { setMenu(null); setAdding(false); if (panel) shutPanel(); else setPanel(true) }}><GearIcon /></button>
      {panel && <GraphSettingsPanel id={panelId} settings={settings} onChange={change} filters={filters} onFit={() => fit(ms(400))} onRelayout={relayout} onClose={closePanel} />}
      {adding && <AddCardPanel busy={editing.busy} onAdd={(type) => addAt(type)} onClose={closeAdd} />}
      <div
        ref={surface} className="relationship-surface" role="img" aria-label={'관계도: 설정 ' + nodes.length + '개 · 관계 ' + relationCount + '개'}
        onPointerDownCapture={() => { flags.current.touched = true }} onWheelCapture={() => { flags.current.touched = true }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancelPress} onPointerCancel={cancelPress}
      >
        {sized && (
          <ForceGraph2D<GNode, GLink>
            ref={graph} graphData={graphData} width={box.w} height={box.h} backgroundColor="rgba(0,0,0,0)" minZoom={0.1} maxZoom={8}
            nodeLabel={() => ''} linkLabel={() => ''}
            nodeCanvasObject={(n, ctx, k) => paintNode(n, ctx, k, paint)}
            nodePointerAreaPaint={(n, color, ctx, k) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x ?? 0, n.y ?? 0, hitRadius(n, k, paint), 0, 2 * Math.PI); ctx.fill() }}
            linkColor={(l) => linkColor(l, paint)} linkWidth={(l) => linkWidth(l, paint) / zoom.current} linkHoverPrecision={6}
            linkDirectionalArrowLength={(l) => arrowLength(l, paint)} linkDirectionalArrowRelPos={(l) => arrowPos(l, paint)}
            onRenderFramePost={onRenderFramePost}
            warmupTicks={reduced ? 300 : 60} {...(reduced ? { cooldownTicks: 0 } : {})} d3AlphaMin={0.001}
            enableNodeDrag={!editing.busy && !editing.targetSource}
            onNodeHover={(n) => setHover(n?.id ?? '')} onLinkHover={(l) => setHotLink(l?.id ?? '')}
            onNodeClick={onNodeClick} onLinkClick={onLinkClick} onBackgroundClick={onBackgroundClick}
            onNodeRightClick={(n, e) => pointerMenu({ kind: 'node', id: n.id, x: e.clientX, y: e.clientY })}
            onLinkRightClick={(l, e) => pointerMenu({ kind: 'link', id: l.id, x: e.clientX, y: e.clientY })}
            onBackgroundRightClick={(e) => pointerMenu({ kind: 'pane', x: e.clientX, y: e.clientY, at: toGraph(e.clientX, e.clientY) })}
            onZoom={({ k }) => { zoom.current = k }}
            onEngineTick={() => { const f = flags.current; if (f.early) return; f.early = true; if (!f.touched) fit(0) }}
            onEngineStop={() => { const f = flags.current; if (f.final) return; f.final = true; if (!f.touched) fit(ms(500)) }}
          />
        )}
      </div>
      <GraphKeyboardList
        nodes={nodes} links={graphData.links} names={title} selected={vm.selected?.id ?? ''} onFocusNode={setFocusNode} onFocusLink={setFocusLink}
        onEdit={(id) => { if (!editing.busy) (editing.targetSource ? editing.onPick : editing.onSelect)(id) }} onDelete={(id) => { if (!editing.busy) editing.onDeleteCard(id) }}
        onEditRelation={(id) => { if (!editing.busy) editing.onRelation(id) }} onDeleteRelation={(id) => { if (!editing.busy) editing.onDeleteRelation(id) }}
        onMenu={(kind, id, at) => openMenu({ kind, id, ...at })}
      />
      {menu && <RelationContextMenu key={menu.kind + ':' + menu.x + ':' + menu.y} label={menuLabel(menu)} x={menu.x} y={menu.y} entries={menuEntries(menu)} onClose={() => setMenu(null)} />}
    </div>
  )
}
