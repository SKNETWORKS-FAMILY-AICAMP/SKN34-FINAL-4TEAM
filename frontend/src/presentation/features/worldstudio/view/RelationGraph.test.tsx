// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting } from '../../../../domain/entities/studioWorld'
import { canvasSize, drawnTexts, fakeGraph as fg, mouse, notifyResize } from '../../../../test/forceGraphFake'
import { honggildongMap } from '../../../../test/honggildongGraph'
import { buildSettingRelationshipMap } from '../viewmodel/characterMap'
import type { GLink, GNode } from '../viewmodel/graphModel'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import RelationGraph from './RelationGraph'

// 실제 react-force-graph(d3·canvas)는 그리지 않고 캔버스가 넘기는 값과 부르는 메서드만 붙잡는다(공용 대역: src/test/forceGraphFake).
vi.mock('react-force-graph-2d', () => import('../../../../test/forceGraphFake'))
beforeEach(() => fg.reset())
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

type Rows = ReturnType<typeof newSetting>[]
const actions = (over: Record<string, unknown> = {}) => ({ busy: false, selectedRelations: [] as string[], targetSource: null as string | null, deleteLock: '', onPick: vi.fn(), onSelect: vi.fn(), onConnect: vi.fn(), onRelation: vi.fn(), onDeleteCard: vi.fn(), onDeleteRelation: vi.fn(), onAdd: vi.fn(), onMark: vi.fn(), onCenter: vi.fn(), ...over })
const filters = (over: Record<string, unknown> = {}) => ({ typed: '', onTyped: vi.fn(), choices: [], types: [], hidden: new Set<never>(), onToggleType: vi.fn(), kinds: [], hiddenKinds: new Set<string>(), onToggleKind: vi.fn(), onReset: vi.fn(), center: null, onDepth: vi.fn(), onClearCenter: vi.fn(), ...over })
const noSettings: never[] = []
function Graph({ rows = noSettings, project = buildSettingRelationshipMap, editing, find, filter }: { rows?: Rows | never[]; project?: Parameters<typeof useWorldMapViewModel>[1]; editing: ReturnType<typeof actions>; find?: { id: string; seq: number } | null; filter?: ReturnType<typeof filters> }) {
 const vm = useWorldMapViewModel(rows as Rows, project)
 return <RelationGraph vm={vm} editing={editing} find={find} filters={filter ?? filters()} />
}
/** 가람이 나래·다온과, 나래가 다온과 이어지고 가람↔나래는 관계가 둘인 세계(선 3개, 관계 4개). */
function triangle() {
 const a = newSetting('people'), b = newSetting('people'), c = newSetting('people'); a.item.title = '가람'; b.item.title = '나래'; c.item.title = '다온'
 let rows = putRelation([a, b, c], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
 rows = putRelation(rows, { subjectId: b.item.id, targetId: a.item.id, predicate: 'trusts', polarity: 'asserted' })
 rows = putRelation(rows, { subjectId: a.item.id, targetId: c.item.id, predicate: 'friend_of', polarity: 'asserted' })
 rows = putRelation(rows, { subjectId: b.item.id, targetId: c.item.id, predicate: 'friend_of', polarity: 'asserted' })
 return { a, b, c, rows }
}

/** 사람 `count`명이 고리로 이어진 세계(모두 이웃이 둘이라 위성이 없다): 노드 수를 채울 때 쓴다. */
function ringOf(count: number, prefix = '고리') {
 const people = Array.from({ length: count }, (_, i) => { const s = newSetting('people'); s.item.title = prefix + i; return s })
 let rows: Rows = people
 for (let i = 0; i < count; i++) rows = putRelation(rows, { subjectId: people[i].item.id, targetId: people[(i + 1) % count].item.id, predicate: 'friend_of', polarity: 'asserted' })
 return rows
}

const props = () => fg.props!
/** 가장 최근에 정한 전하 세기(노드마다 정하는 함수): 외톨이(관계 0)와 이어진 노드가 다르다. */
const charge = (degree = 1) => fg.forces.charge.strength.mock.lastCall[0]({ degree })
const data = () => props().graphData as { nodes: GNode[]; links: GLink[] }
const nodeOf = (name: string) => data().nodes.find((n) => n.name === name)!
const endId = (end: string | GNode) => (typeof end === 'string' ? end : end.id)
const linkOf = (a: string, b: string) => data().links.find((l) => [endId(l.source), endId(l.target)].sort().join() === [nodeOf(a).id, nodeOf(b).id].sort().join())!
const root = () => document.querySelector<HTMLElement>('.relationship-flow')!
const menuItem = (name: string | RegExp) => screen.getByRole('menuitem', { name })
const hover = (name: string) => act(() => props().onNodeHover(nodeOf(name), null))
const unhover = () => act(() => props().onNodeHover(null, null))
const nodeNames = () => data().nodes.map((n) => n.name)
/** 노드를 격자로 흩어 놓고 선의 끝점을 노드 객체로 바꾼다(react-force-graph가 하는 일): 좌표가 없으면 모두 한 점이라 이름표가 겹쳐 숨는다. */
const spread = () => fg.place()
/** 지금 캔버스에 그려지는 글 중에 이 글을 담은 것이 있는지. */
const shows = (text: string) => drawnTexts().some((t) => t.includes(text))
const linkColors = (a: string, b: string) => [props().linkColor(linkOf(a, b)), props().linkWidth(linkOf(a, b))]

it('캔버스는 설정·관계 수를 알리는 그림(role=img)이고, 같은 두 설정 사이의 여러 관계는 선 하나로 이어 그린다(관계는 모두 남는다)', () => {
 const { rows } = triangle()
 render(<Graph rows={rows} editing={actions()} />)
 const img = screen.getByRole('img', { name: '관계도: 설정 3개 · 관계 4개' })
 expect(img).toBeTruthy()
 expect(data().nodes.map((n) => n.name)).toEqual(['가람', '나래', '다온'])
 expect(data().links).toHaveLength(3)
 expect(linkOf('가람', '나래').relations).toHaveLength(2)
 expect(typeof props().nodeCanvasObject).toBe('function')
 expect(props().linkDirectionalArrowLength(linkOf('가람', '나래'))).toBe(0) // 옵시디언처럼 화살표는 기본 꺼짐
})

it('상자가 숨겨져(크기 0) 있으면 그래프를 그리지 않고, 보이게 되면 그린다(관계 편집기는 다른 화면에서도 숨은 채 마운트돼 있다)', () => {
 canvasSize.w = 0; canvasSize.h = 0
 render(<Graph rows={triangle().rows} editing={actions()} />)
 expect(fg.props).toBeNull()
 canvasSize.w = 800; canvasSize.h = 600
 act(() => notifyResize())
 expect(props().width).toBe(800)
 expect(props().height).toBe(600)
})

it('힘은 옵시디언 기본값으로 정해진다: 반발력 6→전하 −180, 연결 힘 0.7·거리 60, 중력(가로세로비)과 이름표 포함 겹침 방지 힘이 더해진다', () => {
 render(<Graph rows={triangle().rows} editing={actions()} />)
 expect(charge()).toBe(-180)
 expect(charge(0)).toBe(-30) // 외톨이는 약하게 밀어낸다(무리 가장자리에 촘촘히)
 expect(fg.forces.link.distance).toHaveBeenCalledWith(60)
 expect(fg.forces.link.strength).toHaveBeenCalledWith(0.7)
 for (const name of ['gravity', 'collide']) expect(typeof fg.forces[name]).toBe('function')
 expect(typeof fg.forces.collide.initialize).toBe('function')
 expect(fg.methods.d3ReheatSimulation).not.toHaveBeenCalled() // 처음에는 다시 데우지 않는다
})

it('설정 패널은 톱니로 열고 닫으며(Esc도 닫고 초점은 톱니로), 힘 슬라이더를 바꾸면 힘을 다시 정하고 시뮬레이션을 다시 데운다', () => {
 render(<Graph rows={triangle().rows} editing={actions()} />)
 const gear = screen.getByRole('button', { name: '그래프 설정' })
 expect(gear.getAttribute('aria-expanded')).toBe('false')
 expect(screen.queryByRole('group', { name: '그래프 설정' })).toBeNull()
 fireEvent.click(gear)
 const panel = screen.getByRole('group', { name: '그래프 설정' })
 expect(gear.getAttribute('aria-expanded')).toBe('true')
 expect(gear.getAttribute('aria-controls')).toBe(panel.id)
 for (const name of ['중심력', '반발력', '연결 힘', '연결 거리']) expect(within(panel).getByRole('slider', { name })).toBeTruthy()
 fireEvent.change(within(panel).getByRole('slider', { name: '반발력' }), { target: { value: '10' } })
 expect(charge()).toBe(-300)
 fireEvent.change(within(panel).getByRole('slider', { name: '연결 거리' }), { target: { value: '120' } })
 expect(fg.forces.link.distance).toHaveBeenLastCalledWith(120)
 fireEvent.change(within(panel).getByRole('slider', { name: '연결 힘' }), { target: { value: '0.4' } })
 expect(fg.forces.link.strength).toHaveBeenLastCalledWith(0.4)
 const before = fg.forces.gravity
 fireEvent.change(within(panel).getByRole('slider', { name: '중심력' }), { target: { value: '1' } })
 expect(fg.forces.gravity).not.toBe(before) // 중력은 세기가 든 새 힘으로 바꾼다
 expect(fg.methods.d3ReheatSimulation.mock.calls.length).toBeGreaterThanOrEqual(4)
 fireEvent.keyDown(within(panel).getByRole('slider', { name: '반발력' }), { key: 'Escape' })
 expect(screen.queryByRole('group', { name: '그래프 설정' })).toBeNull()
 expect(document.activeElement).toBe(gear)
})

it('오른쪽 클릭 메뉴를 열어도 설정 패널은 닫히지 않고 거기서 쓰던 설정 찾기 글도 그대로다(+ 설정 추가 패널은 닫힌다)', () => {
 const onTyped = vi.fn()
 render(<Graph rows={triangle().rows} editing={actions()} filter={filters({ typed: '가', onTyped })} />)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 act(() => props().onNodeRightClick(nodeOf('가람'), mouse()))
 expect(screen.getByRole('menu', { name: '가람 메뉴' })).toBeTruthy()
 expect(screen.getByRole('group', { name: '그래프 설정' })).toBeTruthy()
 expect(onTyped).not.toHaveBeenCalled()
 fireEvent.keyDown(screen.getByRole('menu', { name: '가람 메뉴' }), { key: 'Escape' })
 fireEvent.click(screen.getByRole('button', { name: '+ 설정 추가' })) // 추가 패널을 열면 설정 패널은 닫힌다(둘은 함께 열리지 않는다)
 expect(screen.queryByRole('group', { name: '그래프 설정' })).toBeNull()
 expect(screen.getByRole('dialog', { name: '설정 추가' })).toBeTruthy()
 act(() => props().onBackgroundRightClick(mouse()))
 expect(screen.queryByRole('dialog', { name: '설정 추가' })).toBeNull() // 메뉴를 열면 추가 패널은 닫힌다
})

it('키보드로 연 설정 패널은 톱니에 초점이 있는 채로도 Esc로 닫힌다(초점은 톱니에 그대로)', () => {
 render(<Graph rows={triangle().rows} editing={actions()} />)
 const gear = screen.getByRole('button', { name: '그래프 설정' })
 gear.focus()
 fireEvent.click(gear)
 expect(screen.getByRole('group', { name: '그래프 설정' })).toBeTruthy()
 fireEvent.keyDown(gear, { key: 'Escape' })
 expect(screen.queryByRole('group', { name: '그래프 설정' })).toBeNull()
 expect(document.activeElement).toBe(gear)
})

it('+ 설정 추가 패널로 만든 설정은 캔버스 상자가 화면 어디에 있든 보이는 화면 가운데에서 시작한다(상자 안 좌표를 화면 좌표로 착각하지 않는다)', () => {
 function Live() {
  const [rows, setRows] = useState<Rows>(triangle().rows)
  return <Graph rows={rows} editing={actions({ onAdd: () => { const added = newSetting('people'); added.item.title = '새 인물'; setRows((all) => [...all, added]); return added.item.id } })} />
 }
 vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return (this.classList.contains('relationship-surface') ? { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600, x: 100, y: 50, toJSON() {} } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect })
 render(<Live />)
 fireEvent.click(screen.getByRole('button', { name: '+ 설정 추가' }))
 fireEvent.click(within(screen.getByRole('dialog', { name: '설정 추가' })).getByRole('button', { name: '인물' }))
 expect(fg.methods.screen2GraphCoords).toHaveBeenLastCalledWith(400, 300) // 상자 안 가운데(상자의 화면 위치를 더하거나 빼지 않는다)
 expect([nodeOf('새 인물').x, nodeOf('새 인물').y]).toEqual([0, 0])
})

it('연결 상대를 고르는 중에는 키보드 목록의 설정을 Enter로 활성화하면 정보 편집이 아니라 상대로 고른다(키보드로 연결을 끝낼 수 있다)', () => {
 const { rows, c } = triangle(), editing = actions({ targetSource: 'x' })
 render(<Graph rows={rows} editing={editing} />)
 const node = within(screen.getByRole('region', { name: '키보드로 관계도 조작' })).getByRole('button', { name: /^다온 · / })
 fireEvent.keyDown(node, { key: 'Enter' })
 expect(editing.onPick).toHaveBeenCalledWith(c.item.id)
 expect(editing.onSelect).not.toHaveBeenCalled()
 fireEvent.click(node) // Space·마우스(click)도 같다
 expect(editing.onPick).toHaveBeenCalledTimes(2)
})

it('외톨이 표시를 끈 채 설정을 더하면 새 설정(관계 0)이 보이도록 외톨이 표시가 다시 켜지고 새 설정을 선택·강조한다', () => {
 const marked = vi.fn()
 function Live() {
  const [rows, setRows] = useState<Rows>(triangle().rows)
  return <Graph rows={rows} editing={actions({ onMark: marked, onAdd: () => { const added = newSetting('people'); added.item.title = '새 인물'; setRows((all) => [...all, added]); return added.item.id } })} />
 }
 render(<Live />)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 fireEvent.click(screen.getByRole('checkbox', { name: '외톨이 표시' })) // 끈다
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 fireEvent.click(screen.getByRole('button', { name: '+ 설정 추가' }))
 fireEvent.click(within(screen.getByRole('dialog', { name: '설정 추가' })).getByRole('button', { name: '인물' }))
 expect(nodeNames()).toContain('새 인물')
 expect(marked).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 expect((screen.getByRole('checkbox', { name: '외톨이 표시' }) as HTMLInputElement).checked).toBe(true)
})

it('표시 설정: 화살표를 켜면 방향 있는 관계의 선에 화살표가 생기고, 선 두께·노드 크기·텍스트 임계값 슬라이더가 있다(화면 상태일 뿐 저장하지 않는다)', () => {
 const { rows } = triangle()
 render(<Graph rows={rows} editing={actions()} />)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const panel = screen.getByRole('group', { name: '그래프 설정' })
 for (const name of ['텍스트 표시 임계값', '노드 크기', '선 두께']) expect(within(panel).getByRole('slider', { name })).toBeTruthy()
 const directed = linkOf('가람', '나래') // trusts(나래→가람)는 방향 있는 관계
 expect(directed.directed).toBe(true)
 fireEvent.click(within(panel).getByRole('checkbox', { name: '화살표' }))
 expect(props().linkDirectionalArrowLength(directed)).toBeGreaterThan(0)
 fireEvent.change(within(panel).getByRole('slider', { name: '선 두께' }), { target: { value: '2' } })
 expect(props().linkWidth(directed)).toBe(2)
 act(() => props().onZoom({ k: 2, x: 0, y: 0 }))
 expect(props().linkWidth(directed)).toBe(2) // 확대해도 같다: react-force-graph가 배율로 나누므로 우리는 나누지 않는다
})

it('외톨이는 노드가 60개를 넘는 큰 세계관에서만 기본으로 숨기고(바깥에 점 고리를 만들지 않게) 켜고 끌 수 있다. 관계가 하나도 없는 세계는 빈 화면이 되지 않게 늘 보인다', () => {
 const { rows } = triangle(), loner = newSetting('people'); loner.item.title = '홀로'
 render(<Graph rows={[...rows, loner]} editing={actions()} />)
 expect(nodeNames()).toContain('홀로') // 작은 세계는 외톨이도 보인다
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const toggle = screen.getByRole('checkbox', { name: '외톨이 표시' }) as HTMLInputElement
 expect(toggle.checked).toBe(true)
 fireEvent.click(toggle)
 expect(nodeNames()).toEqual(['가람', '나래', '다온'])
 expect(screen.getByRole('img', { name: /설정 3개/ })).toBeTruthy()
 fireEvent.click(toggle)
 expect(nodeNames()).toContain('홀로')
 cleanup()
 const lone = newSetting('people'); lone.item.title = '홀로'
 render(<Graph rows={[...ringOf(60), lone]} editing={actions()} />) // 61노드: 큰 세계관
 expect(nodeNames()).not.toContain('홀로')
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const big = screen.getByRole('checkbox', { name: '외톨이 표시' }) as HTMLInputElement
 expect(big.checked).toBe(false)
 fireEvent.click(big)
 expect(nodeNames()).toContain('홀로')
 cleanup()
 const a1 = newSetting('people'), b1 = newSetting('people'); a1.item.title = '가'; b1.item.title = '나'
 render(<Graph rows={[a1, b1]} editing={actions()} />) // 관계가 하나도 없다
 expect(nodeNames()).toEqual(['가', '나'])
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 expect((screen.getByRole('checkbox', { name: '외톨이 표시' }) as HTMLInputElement).disabled).toBe(true)
})

it('필터: 유형 체크박스는 편집기가 준 상태를 따르고(마지막 하나는 잠긴다), 설정 찾기는 입력과 선택지를 편집기에 넘긴다', () => {
 const onToggleType = vi.fn(), onTyped = vi.fn()
 const types = [{ id: 'character' as const, label: '인물', count: 3, locked: false }, { id: 'location' as const, label: '장소', count: 1, locked: true }]
 render(<Graph rows={triangle().rows} editing={actions()} filter={filters({ types, hidden: new Set(['location']), onToggleType, onTyped, typed: '가', choices: [{ id: 'x', name: '가람' }] })} />)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const panel = screen.getByRole('group', { name: '그래프 설정' })
 const character = within(panel).getByRole('checkbox', { name: '인물 3' }) as HTMLInputElement, location = within(panel).getByRole('checkbox', { name: '장소 1' }) as HTMLInputElement
 expect([character.checked, location.checked]).toEqual([true, false])
 expect([character.disabled, location.disabled]).toEqual([false, true])
 fireEvent.click(character)
 expect(onToggleType).toHaveBeenCalledWith('character')
 const search = within(panel).getByRole('combobox', { name: '설정 찾기' })
 expect((search as HTMLInputElement).value).toBe('가')
 fireEvent.change(search, { target: { value: '가람' } })
 expect(onTyped).toHaveBeenCalledWith('가람')
 expect(document.querySelector('datalist')!.querySelectorAll('option')).toHaveLength(1)
 onTyped.mockClear()
 fireEvent.keyDown(search, { key: 'Escape' }) // 패널을 닫으면 설정 찾기 글도 지운다(닫힌 패널 뒤에 흐려진 노드만 남지 않게)
 expect(onTyped).toHaveBeenLastCalledWith('')
 expect(screen.queryByRole('group', { name: '그래프 설정' })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 onTyped.mockClear()
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 expect(onTyped).toHaveBeenLastCalledWith('') // 톱니로 닫을 때도 같다
})

it('노드에 올리면 그 노드·이웃·닿는 선만 또렷하고 나머지는 흐리며(선도 강조색·굵게), 벗어나면 되돌아온다', () => {
 const { rows } = triangle(), loner = newSetting('people'); loner.item.title = '홀로'
 render(<Graph rows={[...rows, loner]} editing={actions()} />)
 const [baseColor, baseWidth] = linkColors('가람', '나래')
 expect(linkColors('나래', '다온')).toEqual([baseColor, baseWidth]) // 평소는 모든 선이 같은 가는 회색
 hover('홀로') // 이웃이 없는 노드를 올리면 모든 선이 흐려진다
 expect(props().linkColor(linkOf('가람', '나래'))).not.toBe(baseColor)
 unhover()
 expect(linkColors('가람', '나래')).toEqual([baseColor, baseWidth])
 hover('가람')
 const [lit, litWidth] = linkColors('가람', '나래'), [dim] = linkColors('나래', '다온') // 나래-다온은 가람에 닿지 않는 이웃끼리의 선
 expect(lit).not.toBe(baseColor)
 expect(litWidth).toBeGreaterThan(baseWidth as number)
 expect(dim).not.toBe(lit)
 expect(dim).not.toBe(baseColor)
 unhover()
 expect(linkColors('나래', '다온')).toEqual([baseColor, baseWidth])
})

it('노드를 누르면 그 설정을 선택하며 강조를 고정하고(마우스를 치워도 남는다), 시간이 지난 뒤 같은 노드를 다시 누르면 푼다', () => {
 vi.useFakeTimers({ toFake: ['Date'] })
 const { rows, a } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 const base = linkColors('나래', '다온')[0]
 act(() => props().onNodeClick(nodeOf('가람'), mouse()))
 expect(editing.onPick).toHaveBeenCalledWith(a.item.id)
 unhover()
 expect(props().linkColor(linkOf('나래', '다온'))).not.toBe(base)
 vi.setSystemTime(Date.now() + 2000)
 act(() => props().onNodeClick(nodeOf('가람'), mouse())) // 더블클릭이 아닌 두 번째 누르기: 고정을 푼다
 expect(props().linkColor(linkOf('나래', '다온'))).toBe(base)
 expect(editing.onSelect).not.toHaveBeenCalled()
})

it('연속 두 번 누르면(더블클릭) 정보 편집 화면으로 가고 강조 고정은 첫 누르기 그대로 둔다. 느리게 두 번 누르면 각각 한 번씩의 누르기다', () => {
 vi.useFakeTimers({ toFake: ['Date'] })
 const { rows, b, c } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 const base = linkColors('가람', '다온')[0]
 act(() => props().onNodeClick(nodeOf('나래'), mouse()))
 vi.setSystemTime(Date.now() + 150)
 act(() => props().onNodeClick(nodeOf('나래'), mouse()))
 expect(editing.onSelect.mock.calls).toEqual([[b.item.id]])
 expect(editing.onPick).toHaveBeenCalledTimes(1) // 두 번째는 더블클릭으로만 쓰인다
 const lit = linkColors('나래', '다온')[0], dim = linkColors('가람', '다온')[0]
 expect(new Set([base, lit, dim]).size).toBe(3) // 나래를 고정한 채다: 닿는 선은 강조색, 나래에 닿지 않는 가람-다온 선은 흐리다(평소와 모두 다르다)
 vi.setSystemTime(Date.now() + 2000)
 act(() => props().onNodeClick(nodeOf('다온'), mouse()))
 vi.setSystemTime(Date.now() + 2000)
 act(() => props().onNodeClick(nodeOf('다온'), mouse()))
 expect(editing.onSelect).toHaveBeenCalledTimes(1) // 느린 두 번째 누르기는 더블클릭이 아니다
 expect(editing.onPick.mock.calls.map((x) => x[0])).toEqual([b.item.id, c.item.id, c.item.id])
})

it('빈 곳을 누르거나 Esc를 누르면 고정한 강조를 푼다. 연결 상대를 고르는 중에는 노드를 눌러도 고정하지 않고 상대로 고르며, 처리 중에는 누르기를 받지 않고 노드를 끌지도 못한다', () => {
 const { rows } = triangle(), editing = actions()
 const view = render(<Graph rows={rows} editing={editing} />)
 const base = linkColors('나래', '다온')[0]
 act(() => props().onNodeClick(nodeOf('가람'), mouse()))
 expect(props().linkColor(linkOf('나래', '다온'))).not.toBe(base)
 act(() => props().onBackgroundClick(mouse()))
 expect(props().linkColor(linkOf('나래', '다온'))).toBe(base)
 act(() => props().onNodeClick(nodeOf('가람'), mouse()))
 expect(props().linkColor(linkOf('나래', '다온'))).not.toBe(base)
 fireEvent.keyDown(root(), { key: 'Escape' })
 expect(props().linkColor(linkOf('나래', '다온'))).toBe(base)
 expect(props().enableNodeDrag).toBe(true)
 view.rerender(<Graph rows={rows} editing={{ ...editing, targetSource: 'x' }} />) // 연결 상대를 고르는 중
 act(() => props().onNodeClick(nodeOf('다온'), mouse()))
 expect(editing.onPick).toHaveBeenLastCalledWith(nodeOf('다온').id) // 상대로 고른다
 expect(props().linkColor(linkOf('가람', '나래'))).toBe(linkColors('가람', '나래')[0]) // 강조 고정 없음
 expect(props().linkColor(linkOf('가람', '나래'))).toBe(base)
 expect(props().enableNodeDrag).toBe(false) // 끌기는 끈다(누르기만 받는다)
 const picks = editing.onPick.mock.calls.length
 view.rerender(<Graph rows={rows} editing={{ ...editing, targetSource: null, busy: true }} />)
 expect(props().enableNodeDrag).toBe(false)
 act(() => props().onNodeClick(nodeOf('나래'), mouse()))
 expect(editing.onPick).toHaveBeenCalledTimes(picks) // 처리 중에는 누르기를 받지 않는다
})

it('관계가 하나뿐인 선을 누르면 관계 편집 시트로 가고, 마우스를 올린 선에는 관계 이름이 선 위에 보이며, 올린 선에서 Delete는 관계가 하나일 때 바로 삭제를 요청한다', () => {
 const { rows } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 const single = linkOf('나래', '다온')
 act(() => props().onLinkClick(single, mouse()))
 expect(editing.onRelation).toHaveBeenCalledWith(single.relations[0].id)
 spread()
 expect(shows('친구')).toBe(false) // 평소 선 위 관계 이름은 숨김
 act(() => props().onLinkHover(single, null))
 expect(shows('친구')).toBe(true)
 fireEvent.keyDown(root(), { key: 'Delete' })
 expect(editing.onDeleteRelation).toHaveBeenCalledWith(single.relations[0].id)
 act(() => props().onLinkHover(null, single))
 expect(shows('친구')).toBe(false)
})

it('지금 관계 작성 중인 쌍의 선(selectedRelations)은 강조색·굵게 그리고 관계 이름을 늘 보인다', () => {
 const { rows } = triangle(), pair = (() => { render(<Graph rows={rows} editing={actions()} />); const link = linkOf('가람', '나래'); cleanup(); return link })()
 const editing = actions({ selectedRelations: [pair.relations[0].id] })
 render(<Graph rows={rows} editing={editing} />)
 const [color, width] = linkColors('가람', '나래')
 expect([color, width]).not.toEqual(linkColors('나래', '다온'))
 spread()
 expect(shows('친구')).toBe(true)
})

it('빈 곳을 오른쪽 클릭하면 캔버스 메뉴가 열려 여기에 설정 추가(8유형)·배치 정돈·화면 맞춤을 고를 수 있고, 새 노드는 누른 자리에서 물리에 합류한다', () => {
 function Live() {
  const [rows, setRows] = useState<Rows>(triangle().rows)
  const editing = actions({ onAdd: (type: string) => { const added = newSetting('people'); added.item.title = '새 인물'; setRows((all) => [...all, added]); live.onAdd(type); return added.item.id } })
  return <Graph rows={rows} editing={editing} />
 }
 const live = actions()
 render(<Live />)
 act(() => props().onBackgroundRightClick(mouse(500, 400)))
 const menu = screen.getByRole('menu', { name: '캔버스 메뉴' })
 expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['여기에 설정 추가', '배치 정돈', '화면 맞춤'])
 fireEvent.click(menuItem('여기에 설정 추가'))
 expect(within(screen.getByRole('menu', { name: '여기에 설정 추가' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['인물', '장소', '조직', '능력', '사물', '규칙', '사건', '기타'])
 fireEvent.click(menuItem('장소'))
 expect(live.onAdd).toHaveBeenCalledWith('location')
 expect(screen.queryByRole('menu')).toBeNull()
 const added = nodeOf('새 인물')
 expect([added.x, added.y]).toEqual([100, 100]) // 누른 자리(500,400)를 그래프 좌표(−400,−300)로 바꾼 곳
 expect(fg.methods.centerAt).toHaveBeenCalledWith(100, 100, expect.any(Number)) // 새 노드로 다가가고
 expect(screen.getByRole('img', { name: /설정 4개/ })).toBeTruthy()
})

it('새 설정을 만들면 그 노드를 선택(onMark)하고 강조를 고정한다', () => {
 function Live() {
  const [rows, setRows] = useState<Rows>(triangle().rows)
  return <Graph rows={rows} editing={actions({ onAdd: () => { const added = newSetting('people'); added.item.title = '새 인물'; setRows((all) => [...all, added]); marked.id = added.item.id; return added.item.id }, onMark: marked.fn })} />
 }
 const marked = { id: '', fn: vi.fn() }
 render(<Live />)
 fireEvent.click(screen.getByRole('button', { name: '+ 설정 추가' }))
 const panel = screen.getByRole('dialog', { name: '설정 추가' })
 fireEvent.click(within(panel).getByRole('button', { name: '인물' }))
 expect(marked.fn).toHaveBeenCalledWith(marked.id)
 expect(screen.queryByRole('dialog', { name: '설정 추가' })).toBeNull() // 추가하면 패널은 닫힌다
 expect(fg.methods.centerAt).toHaveBeenCalled()
})

it('+ 설정 추가·메뉴는 처리 중이면 막히고, 만든 id가 없으면(처리 중) 아무것도 하지 않는다', () => {
 const editing = actions({ busy: true, onAdd: vi.fn(() => undefined) })
 render(<Graph rows={triangle().rows} editing={editing} />)
 act(() => props().onBackgroundRightClick(mouse()))
 fireEvent.click(menuItem('여기에 설정 추가'))
 expect(within(screen.getByRole('menu', { name: '여기에 설정 추가' })).getByRole('menuitem', { name: '인물' }).getAttribute('aria-disabled')).toBe('true')
 expect(editing.onAdd).not.toHaveBeenCalled()
})

it('배치 정돈은 노드를 중심 근처에 다시 놓고 고정을 풀어 시뮬레이션을 다시 시작하며, 화면 맞춤은 모든 노드를 한 화면에 맞춘다(패널의 버튼과 오른쪽 클릭 메뉴가 같은 동작)', () => {
 render(<Graph rows={triangle().rows} editing={actions()} />)
 for (const n of data().nodes) Object.assign(n, { x: 900, y: 900, vx: 5, vy: 5, fx: 900, fy: 900 })
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 fireEvent.click(screen.getByRole('button', { name: '배치 정돈' }))
 for (const n of data().nodes) { expect(Math.hypot(n.x!, n.y!)).toBeLessThan(40); expect([n.vx, n.vy, n.fx, n.fy]).toEqual([0, 0, undefined, undefined]) }
 expect(fg.methods.d3ReheatSimulation).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button', { name: '화면 맞춤' }))
 expect(fg.methods.zoomToFit).toHaveBeenCalledTimes(1)
 act(() => props().onBackgroundRightClick(mouse()))
 fireEvent.click(menuItem('배치 정돈'))
 expect(fg.methods.d3ReheatSimulation).toHaveBeenCalledTimes(2)
 act(() => props().onBackgroundRightClick(mouse()))
 fireEvent.click(menuItem('화면 맞춤'))
 expect(fg.methods.zoomToFit).toHaveBeenCalledTimes(2)
})

it('노드를 오른쪽 클릭하면 그 노드의 메뉴가 열려 정보 편집·관계 연결·삭제가 기존 동작을 부르고, 삭제가 잠기면 이유를 보인다', () => {
 const { rows, a } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 act(() => props().onNodeRightClick(nodeOf('가람'), mouse(30, 40)))
 const menu = screen.getByRole('menu', { name: '가람 메뉴' })
 expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['정보 편집', '관계 연결', '이 설정 중심으로 보기', '삭제'])
 fireEvent.click(menuItem('정보 편집'))
 expect(editing.onSelect).toHaveBeenCalledWith(a.item.id)
 act(() => props().onNodeRightClick(nodeOf('가람'), mouse()))
 fireEvent.click(menuItem('관계 연결'))
 expect(editing.onConnect).toHaveBeenCalledWith(a.item.id)
 act(() => props().onNodeRightClick(nodeOf('가람'), mouse()))
 fireEvent.click(menuItem('삭제'))
 expect(editing.onDeleteCard).toHaveBeenCalledWith(a.item.id)
 cleanup()
 render(<Graph rows={rows} editing={actions({ deleteLock: '회차를 고른 동안은 삭제할 수 없어요.' })} />)
 act(() => props().onNodeRightClick(nodeOf('가람'), mouse()))
 expect(menuItem('삭제').getAttribute('aria-disabled')).toBe('true')
 expect(screen.getByText('회차를 고른 동안은 삭제할 수 없어요.')).toBeTruthy()
})

it('이름 없는 설정은 관계 연결이 잠기고, 처리 중에는 정보 편집·삭제도 잠긴다', () => {
 const blank = newSetting('people'), named = newSetting('people'); named.item.title = '나래'
 render(<Graph rows={[blank, named]} editing={actions()} />)
 act(() => props().onNodeRightClick(data().nodes.find((n) => n.unnamed)!, mouse()))
 expect(menuItem('관계 연결').getAttribute('aria-disabled')).toBe('true')
 cleanup()
 render(<Graph rows={[blank, named]} editing={actions({ busy: true })} />)
 act(() => props().onNodeRightClick(nodeOf('나래'), mouse()))
 expect(['정보 편집', '관계 연결', '삭제'].map((n) => menuItem(n).getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true'])
})

it('선을 오른쪽 클릭하면 관계 편집·관계 삭제가 열린다(관계가 하나인 선). 관계가 둘인 선의 삭제는 어느 관계인지 고르는 하위 목록이다', () => {
 const { rows } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 const single = linkOf('나래', '다온'), pair = linkOf('가람', '나래')
 act(() => props().onLinkRightClick(single, mouse()))
 expect(within(screen.getByRole('menu', { name: '관계선 메뉴' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['관계 편집', '관계 삭제'])
 fireEvent.click(menuItem('관계 편집'))
 expect(editing.onRelation).toHaveBeenCalledWith(single.relations[0].id)
 act(() => props().onLinkRightClick(single, mouse()))
 fireEvent.click(menuItem('관계 삭제'))
 expect(editing.onDeleteRelation).toHaveBeenCalledWith(single.relations[0].id)
 act(() => props().onLinkRightClick(pair, mouse()))
 fireEvent.click(menuItem('관계 삭제'))
 const names = within(screen.getByRole('menu', { name: '관계 삭제' })).getAllByRole('menuitem').map((i) => i.textContent)
 expect(names).toHaveLength(2)
 expect(names.join()).toMatch(/친구/)
 fireEvent.click(within(screen.getByRole('menu', { name: '관계 삭제' })).getAllByRole('menuitem')[1])
 expect(editing.onDeleteRelation).toHaveBeenLastCalledWith(pair.relations[1].id)
 act(() => props().onLinkRightClick(pair, mouse()))
 fireEvent.click(menuItem('관계 편집')) // 관계가 둘이면 편집도 어느 관계인지 고르는 하위 목록이다
 fireEvent.click(within(screen.getByRole('menu', { name: '관계 편집' })).getAllByRole('menuitem')[0])
 expect(editing.onRelation).toHaveBeenLastCalledWith(pair.relations[0].id)
})

it('터치로 노드를 길게 누르면(600ms) 그 노드의 메뉴가 열리고, 움직이면 취소되며, 빈 곳을 길게 누르면 캔버스 메뉴가 열린다. 메뉴를 연 뒤 첫 누르기는 건너뛴다', () => {
 vi.useFakeTimers()
 const { rows } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 spread() // 가람 (−380,−300) 나래 (−190,−300) 다온 (0,−300): 화면 좌표는 (20,0) (210,0) (400,0)
 const surface = screen.getByRole('img', { name: /^관계도/ })
 const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => fireEvent[type](surface, { pointerType: 'touch', clientX: x, clientY: y })
 touch('pointerDown', 20, 0)
 act(() => { vi.advanceTimersByTime(599) })
 expect(screen.queryByRole('menu')).toBeNull()
 act(() => { vi.advanceTimersByTime(2) })
 expect(screen.getByRole('menu', { name: '가람 메뉴' })).toBeTruthy()
 act(() => props().onNodeClick(nodeOf('가람'), mouse())) // 길게 눌러 연 뒤 손가락을 뗄 때 오는 click은 건너뛴다
 expect(editing.onPick).not.toHaveBeenCalled()
 cleanup()
 render(<Graph rows={rows} editing={editing} />)
 spread()
 const surface2 = screen.getByRole('img', { name: /^관계도/ })
 fireEvent.pointerDown(surface2, { pointerType: 'touch', clientX: 210, clientY: 0 })
 fireEvent.pointerMove(surface2, { pointerType: 'touch', clientX: 240, clientY: 0 }) // 10px를 넘게 움직임: 취소
 act(() => { vi.advanceTimersByTime(700) })
 expect(screen.queryByRole('menu')).toBeNull()
 fireEvent.pointerDown(surface2, { pointerType: 'touch', clientX: 600, clientY: 500 })
 act(() => { vi.advanceTimersByTime(700) })
 expect(screen.getByRole('menu', { name: '캔버스 메뉴' })).toBeTruthy()
})

it('길게 눌러 선 메뉴를 연 뒤 손가락을 뗄 때 오는 click은 관계 편집 시트를 열지 않고(그 다음 누르기는 평소처럼 연다), 빈 곳 메뉴 뒤의 click은 고정한 강조를 풀지 않는다', () => {
 vi.useFakeTimers()
 const editing = actions()
 render(<Graph rows={triangle().rows} editing={editing} />)
 spread() // 가람 (20,0) — 나래 (210,0): 두 점 사이 선 가운데는 화면 (115,0)
 const surface = screen.getByRole('img', { name: /^관계도/ })
 fireEvent.pointerDown(surface, { pointerType: 'touch', clientX: 115, clientY: 0 })
 act(() => { vi.advanceTimersByTime(601) })
 expect(screen.getByRole('menu', { name: '관계선 메뉴' })).toBeTruthy()
 act(() => props().onLinkClick(linkOf('가람', '나래'), mouse()))
 expect(editing.onRelation).not.toHaveBeenCalled()
 act(() => props().onLinkClick(linkOf('나래', '다온'), mouse())) // 그 다음 누르기는 평소처럼 연다(관계가 하나인 선)
 expect(editing.onRelation).toHaveBeenCalledTimes(1)
 fireEvent.keyDown(screen.getByRole('menu', { name: '관계선 메뉴' }), { key: 'Escape' })
 act(() => props().onNodeClick(nodeOf('다온'), mouse())) // 다온을 눌러 고정한다
 const lit = linkColors('가람', '나래')[0]
 fireEvent.pointerDown(surface, { pointerType: 'touch', clientX: 700, clientY: 500 }) // 빈 곳을 길게 눌러 캔버스 메뉴를 연다
 act(() => { vi.advanceTimersByTime(601) })
 expect(screen.getByRole('menu', { name: '캔버스 메뉴' })).toBeTruthy()
 act(() => props().onBackgroundClick(mouse()))
 expect(linkColors('가람', '나래')[0]).toBe(lit) // 고정이 그대로다
 act(() => props().onBackgroundClick(mouse())) // 다음 빈 곳 누르기는 평소처럼 푼다
 expect(linkColors('가람', '나래')[0]).not.toBe(lit)
})

it('마우스로 누르면 긴 누르기가 없다', () => {
 vi.useFakeTimers()
 render(<Graph rows={triangle().rows} editing={actions()} />)
 spread()
 fireEvent.pointerDown(screen.getByRole('img', { name: /^관계도/ }), { pointerType: 'mouse', clientX: 20, clientY: 0 })
 act(() => { vi.advanceTimersByTime(2000) })
 expect(screen.queryByRole('menu')).toBeNull()
})

it('키보드로 관계도 조작 목록: 설정마다 버튼 하나(Tab 한 번에 들어와 방향키로 오간다), Enter는 정보 편집, 메뉴 키는 같은 노드 메뉴, 초점이 가면 캔버스가 그 노드를 강조한다', () => {
 const { rows, a, b } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 const list = screen.getByRole('region', { name: '키보드로 관계도 조작' })
 const buttons = within(within(list).getByRole('list', { name: '설정 목록' })).getAllByRole('button', { name: /관계 \d+개$/ })
 expect(buttons.map((x) => x.textContent)).toEqual(['가람 · 인물 · 관계 3개', '나래 · 인물 · 관계 3개', '다온 · 인물 · 관계 2개'])
 expect(buttons.map((x) => x.tabIndex)).toEqual([0, -1, -1]) // 한 번의 Tab 자리만
 const base = linkColors('나래', '다온')[0]
 act(() => buttons[0].focus())
 expect(props().linkColor(linkOf('나래', '다온'))).not.toBe(base) // 초점이 간 노드를 올린 것처럼 강조
 fireEvent.keyDown(buttons[0], { key: 'ArrowDown' })
 expect(document.activeElement).toBe(buttons[1])
 expect(buttons.map((x) => x.tabIndex)).toEqual([-1, 0, -1])
 fireEvent.keyDown(buttons[1], { key: 'End' })
 expect(document.activeElement).toBe(buttons[2])
 fireEvent.keyDown(buttons[2], { key: 'Home' })
 expect(document.activeElement).toBe(buttons[0])
 fireEvent.keyDown(buttons[0], { key: 'Enter' })
 expect(editing.onSelect).toHaveBeenCalledWith(a.item.id)
 fireEvent.keyDown(buttons[1], { key: 'Delete' })
 expect(editing.onDeleteCard).toHaveBeenCalledWith(b.item.id)
 fireEvent.keyDown(buttons[0], { key: 'ContextMenu' })
 expect(within(screen.getByRole('menu', { name: '가람 메뉴' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['정보 편집', '관계 연결', '이 설정 중심으로 보기', '삭제'])
 fireEvent.keyDown(screen.getByRole('menu', { name: '가람 메뉴' }), { key: 'Escape' })
 expect(document.activeElement).toBe(buttons[0]) // 메뉴를 닫으면 초점이 목록으로 돌아온다
 act(() => buttons[0].blur())
 expect(props().linkColor(linkOf('나래', '다온'))).toBe(base)
})

it('키보드 목록에서 Shift+F10도 메뉴를 열고, 초점이 간 노드의 관계 목록(방향이 담긴 이름)은 Enter로 관계 편집·Delete로 관계 삭제·메뉴 키로 선 메뉴를 열며 그 선을 강조하고 관계 이름을 보인다', () => {
 const { rows } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 const list = screen.getByRole('region', { name: '키보드로 관계도 조작' })
 const node = within(list).getByRole('button', { name: /^나래 · / })
 const base = linkColors('가람', '다온')[0]
 fireEvent.keyDown(node, { key: 'F10', shiftKey: true })
 expect(screen.getByRole('menu', { name: '나래 메뉴' })).toBeTruthy()
 fireEvent.keyDown(screen.getByRole('menu', { name: '나래 메뉴' }), { key: 'Escape' })
 expect(within(list).queryByRole('list', { name: '나래의 관계' })).toBeNull() // 초점이 간 노드의 관계만 펼친다
 act(() => node.focus())
 const relations = within(within(list).getByRole('list', { name: '나래의 관계' })).getAllByRole('button')
 expect(relations.map((x) => x.textContent).sort()).toEqual(['가람 ↔ 나래 · 친구', '나래 → 가람 · 신뢰', '나래 ↔ 다온 · 친구'].sort())
 const toDaon = relations.find((x) => x.textContent === '나래 ↔ 다온 · 친구')!
 spread()
 expect(shows('친구')).toBe(false) // 노드에 초점이 있어도 선 위 관계 이름은 숨김
 act(() => toDaon.focus())
 expect(shows('친구')).toBe(true) // 초점이 간 관계의 선 위에 관계 이름이 보인다
 expect(props().linkColor(linkOf('가람', '다온'))).not.toBe(base) // 나래에 닿지 않는 선은 흐리다(나래 초점이 그대로)
 fireEvent.keyDown(toDaon, { key: 'Enter' })
 expect(editing.onRelation).toHaveBeenCalledWith(linkOf('나래', '다온').relations[0].id)
 fireEvent.keyDown(toDaon, { key: 'Delete' })
 expect(editing.onDeleteRelation).toHaveBeenCalledWith(linkOf('나래', '다온').relations[0].id)
 fireEvent.keyDown(toDaon, { key: 'ContextMenu' })
 expect(within(screen.getByRole('menu', { name: '관계선 메뉴' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['관계 편집', '관계 삭제'])
 fireEvent.click(menuItem('관계 편집'))
 expect(editing.onRelation).toHaveBeenCalledTimes(2)
})

it('설정 찾기 요청이 오면 그 노드를 화면 가운데로 옮기고 확대는 줄이지 않는다(요청 번호가 바뀔 때만)', () => {
 const { rows, b } = triangle(), editing = actions()
 const view = render(<Graph rows={rows} editing={editing} />)
 Object.assign(nodeOf('나래'), { x: 70, y: -30 })
 view.rerender(<Graph rows={rows} editing={editing} find={{ id: b.item.id, seq: 1 }} />)
 expect(fg.methods.centerAt).toHaveBeenCalledWith(70, -30, expect.any(Number))
 expect(fg.methods.zoom).toHaveBeenCalledWith(1.5, expect.any(Number))
 fg.methods.centerAt.mockClear()
 view.rerender(<Graph rows={rows} editing={editing} find={{ id: b.item.id, seq: 1 }} />)
 expect(fg.methods.centerAt).not.toHaveBeenCalled()
 fg.zoom = 3
 view.rerender(<Graph rows={rows} editing={editing} find={{ id: b.item.id, seq: 2 }} />)
 expect(fg.methods.zoom).toHaveBeenLastCalledWith(3, expect.any(Number)) // 이미 더 확대돼 있으면 줄이지 않는다
})

it('첫 화면: 첫 틱에 곧바로 전체를 맞추고, 배치가 처음 멈추면 한 번 더 맞춘다. 그 사이 사용자가 휠로 움직였으면 그대로 둔다', () => {
 render(<Graph rows={triangle().rows} editing={actions()} />)
 act(() => props().onEngineTick())
 expect(fg.methods.zoomToFit).toHaveBeenCalledTimes(1)
 expect(fg.methods.zoomToFit).toHaveBeenLastCalledWith(0, expect.any(Number))
 act(() => props().onEngineTick())
 expect(fg.methods.zoomToFit).toHaveBeenCalledTimes(1) // 첫 틱에만
 act(() => props().onEngineStop())
 expect(fg.methods.zoomToFit).toHaveBeenCalledTimes(2)
 act(() => props().onEngineStop())
 expect(fg.methods.zoomToFit).toHaveBeenCalledTimes(2) // 처음 멈출 때만(드래그가 끝날 때마다 맞추지 않는다)
 cleanup(); fg.methods.zoomToFit.mockClear()
 render(<Graph rows={triangle().rows} editing={actions()} />)
 act(() => props().onEngineTick())
 fireEvent.wheel(screen.getByRole('img', { name: /^관계도/ }))
 act(() => props().onEngineStop())
 expect(fg.methods.zoomToFit).toHaveBeenCalledTimes(1) // 움직인 화면은 두 번째로 맞추지 않는다
})

it('그래프 데이터는 올리기·고정·패널 같은 화면 상태가 바뀌어도 같은 객체다(바뀌면 시뮬레이션이 처음부터 다시 돈다). 설정이 바뀌어 다시 만들어도 같은 설정의 노드는 같은 객체(배치를 잇는다)다', () => {
 const { rows } = triangle(), editing = actions()
 const view = render(<Graph rows={rows} editing={editing} />)
 const first = props().graphData, gil = nodeOf('가람')
 hover('가람'); unhover()
 act(() => props().onNodeClick(nodeOf('나래'), mouse()))
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 fireEvent.change(screen.getByRole('slider', { name: '선 두께' }), { target: { value: '2' } })
 expect(props().graphData).toBe(first)
 const added = newSetting('people'); added.item.title = '새 인물'
 view.rerender(<Graph rows={[...rows, added]} editing={editing} />)
 expect(props().graphData).not.toBe(first)
 expect(nodeOf('가람')).toBe(gil)
})

it('이름표는 확대 배율과 상관없이 화면 12px 이상이고, 멀리서는 관계가 많은 설정의 이름만 남으며, 숨은 이름의 설정에 올리면 그 이름과 이웃 이름이 보인다(홍길동전 57노드)', () => {
 render(<Graph project={honggildongMap} editing={actions()} />)
 expect(data().nodes).toHaveLength(57) // 60개 이하의 세계관이라 외톨이도 보이고 위성도 접지 않는다
 spread()
 const fonts: number[] = []
 const texts = (zoom: number) => {
  fg.zoom = zoom
  const out: string[] = []
  const ctx = new Proxy({}, { get: (_, prop) => (prop === 'fillText' ? (text: string) => { out.push(text) } : () => {}), set: (_, prop, value) => { if (prop === 'font') fonts.push(Number(/(\d+(?:\.\d+)?)px/.exec(String(value))![1]) * zoom); return true } }) as unknown as CanvasRenderingContext2D
  props().onRenderFramePost(ctx, zoom)
  return out
 }
 const all = texts(1)
 expect(data().nodes.map((n) => n.name).filter((name) => !all.includes(name))).toEqual([]) // 임계값(0.7) 위: 겹치지 않는 이름은 모두
 const far = texts(0.3)
 expect(far.length).toBeGreaterThanOrEqual(1)
 expect(far.length).toBeLessThanOrEqual(12) // 멀리서는 상위 8~12개만
 expect(far).toContain('홍길동')
 expect(Math.min(...fonts)).toBeGreaterThanOrEqual(12 - 1e-9) // 어느 배율에서도 화면 12px 이상
 const hiddenName = data().nodes.filter((n) => !far.includes(n.name) && n.degree > 0).sort((a, b) => a.degree - b.degree)[0].name
 hover(hiddenName)
 const lit = texts(0.3)
 expect(lit).toContain(hiddenName) // 올린 노드의 이름은 늘 보인다(숨어 있던 이름도)
 expect(lit.length).toBeGreaterThan(1)
})

const ring = Array.from({ length: 56 }, (_, i) => '고리' + i)
/** 해그리드가 위성 셋(가·나·다)·허브2와 이어지고 허브2가 라와 이어지는 세계: 가·나·다는 해그리드에, 라는 허브2에 접힌다(접히지 않는 노드는 해그리드·허브2와 고리 56명 = 노드 62개). `ringSize`를 0으로 두면 작은 세계(접지 않는다)다. */
function hubWorld(ringSize = 56) {
 const make = (name: string) => { const s = newSetting('people'); s.item.title = name; return s }
 const [hub, s1, s2, s3, m, x] = ['해그리드', '가', '나', '다', '허브2', '라'].map(make)
 const ring = Array.from({ length: ringSize }, (_, i) => make('고리' + i)) // 서로 이어진 고리: 위성이 없고 노드를 60개 넘게 채운다(큰 세계관)
 let rows: Rows = [hub, s1, s2, s3, m, x, ...ring]
 for (const [from, to] of [[hub, s1], [hub, s2], [hub, s3], [hub, m], [m, x], ...ring.map((r, i) => [r, ring[(i + 1) % ring.length]])]) rows = putRelation(rows, { subjectId: from.item.id, targetId: to.item.id, predicate: 'friend_of', polarity: 'asserted' })
 return { rows, hub, s1, s2, s3, m, x }
}

it('선은 확대 배율과 무관하게 화면 기준 가장 가는 선이다(react-force-graph가 배율로 나누므로 우리는 나누지 않는다): 1px, 고해상도는 1/배율, 합친 평행 관계도 같다', () => {
 render(<Graph rows={triangle().rows} editing={actions()} />)
 const pair = linkOf('가람', '나래'), single = linkOf('나래', '다온')
 expect(pair.relations).toHaveLength(2)
 expect(props().linkWidth(pair)).toBe(1)
 expect(props().linkWidth(single)).toBe(1) // 관계 둘을 합친 선도 한 가닥과 같다
 act(() => props().onZoom({ k: 0.1, x: 0, y: 0 }))
 expect(props().linkWidth(pair)).toBe(1)
 act(() => props().onZoom({ k: 8, x: 0, y: 0 }))
 expect(props().linkWidth(pair)).toBe(1)
 vi.stubGlobal('devicePixelRatio', 2)
 expect(props().linkWidth(pair)).toBe(0.5)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const slider = within(screen.getByRole('group', { name: '그래프 설정' })).getByRole('slider', { name: '선 두께' }) as HTMLInputElement
 expect([slider.min, slider.value]).toEqual(['1', '1']) // 선 두께 슬라이더는 가장 가는 값(최소)이 기본이다
})

it('위성 노드 접기(기본 켬): 이웃이 하나뿐인 노드는 허브 안으로 접혀 그려지지 않고, 허브 이름표는 이름 +N이며, 요약과 키보드 목록도 접힌 상태를 따른다', () => {
 render(<Graph rows={hubWorld().rows} editing={actions()} />)
 expect(nodeNames()).toEqual(['해그리드', '허브2', ...ring])
 expect(data().links).toHaveLength(57)
 expect(screen.getByRole('img', { name: '관계도: 설정 58개 · 관계 57개 · 접힌 위성 4개' })).toBeTruthy()
 spread()
 expect(drawnTexts()).toEqual(expect.arrayContaining(['해그리드 +3', '허브2 +1']))
 const list = within(screen.getByRole('region', { name: '키보드로 관계도 조작' }))
 expect(list.getByRole('button', { name: /^해그리드 · .*접힌 위성 3개$/ })).toBeTruthy()
 expect(list.queryByRole('button', { name: /^가 · / })).toBeNull()
})

it('접힌 허브의 메뉴에서 위성 펼치기·접기를 고르고, 점 아래 이름표(+N)를 눌러도 펼친다. 펼친 위성은 허브 둘레에서 시작한다', () => {
 render(<Graph rows={hubWorld().rows} editing={actions()} />)
 spread()
 const hub = nodeOf('해그리드')
 act(() => props().onNodeRightClick(hub, mouse()))
 expect(within(screen.getByRole('menu', { name: '해그리드 메뉴' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['정보 편집', '관계 연결', '이 설정 중심으로 보기', '위성 펼치기', '삭제'])
 fireEvent.click(menuItem('위성 펼치기'))
 expect(nodeNames()).toEqual(expect.arrayContaining(['해그리드', '가', '나', '다', '허브2']))
 expect(nodeNames()).not.toContain('라') // 다른 허브의 위성은 그대로 접혀 있다
 for (const name of ['가', '나', '다']) expect(Math.hypot(nodeOf(name).x! - hub.x!, nodeOf(name).y! - hub.y!)).toBeLessThan(60)
 expect(screen.getByRole('img', { name: '관계도: 설정 61개 · 관계 60개 · 접힌 위성 1개' })).toBeTruthy()
 act(() => props().onNodeRightClick(nodeOf('해그리드'), mouse()))
 fireEvent.click(menuItem('위성 접기'))
 expect(nodeNames()).toEqual(['해그리드', '허브2', ...ring])
 spread()
 const h = nodeOf('해그리드')
 act(() => props().onNodeClick(h, mouse(h.x! + 400, h.y! + 300))) // 점 한가운데를 누르면 평소 누르기(펼치지 않는다)
 expect(nodeNames()).toEqual(['해그리드', '허브2', ...ring])
 act(() => props().onNodeClick(h, mouse(h.x! + 400, h.y! + 300 + 34))) // 점 아래 이름표 자리
 expect(nodeNames()).toContain('가')
})

it('접힌 허브만 점 아래 이름표 자리까지 눌리는 영역(포인터 영역)이 넓어진다', () => {
 const pointerRects = (name: string) => {
  const calls: string[] = []
  const ctx = new Proxy({}, { get: (_, p) => () => { calls.push(String(p)) }, set: () => true }) as unknown as CanvasRenderingContext2D
  props().nodePointerAreaPaint(nodeOf(name), '#123456', ctx, 1)
  return calls.filter((c) => c === 'fillRect').length
 }
 render(<Graph rows={hubWorld().rows} editing={actions()} />)
 expect(pointerRects('해그리드')).toBe(1)
 cleanup()
 render(<Graph rows={triangle().rows} editing={actions()} />)
 expect(pointerRects('가람')).toBe(0)
})

it('설정 패널의 위성 노드 접기를 끄면 모두 보이고, 켜면 다시 접히며, 모두 펼치기는 접힌 허브를 한꺼번에 펼친다', () => {
 render(<Graph rows={hubWorld().rows} editing={actions()} />)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const toggle = screen.getByRole('checkbox', { name: '위성 노드 접기' }) as HTMLInputElement
 expect(toggle.checked).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: '모두 펼치기' }))
 expect(nodeNames()).toHaveLength(62)
 fireEvent.click(toggle) // 끈다
 expect(nodeNames()).toHaveLength(62)
 expect(screen.queryByRole('button', { name: '모두 펼치기' })).toBeNull()
 fireEvent.click(toggle) // 다시 켜면 처음처럼 접힌다
 expect(nodeNames()).toEqual(['해그리드', '허브2', ...ring])
})

it('설정 찾기가 접힌 노드를 가리키면 그 허브를 펼치고 그 노드로 다가간다', () => {
 const { rows, s2 } = hubWorld()
 const view = render(<Graph rows={rows} editing={actions()} find={null} />)
 expect(nodeNames()).not.toContain('나')
 view.rerender(<Graph rows={rows} editing={actions()} find={{ id: s2.item.id, seq: 1 }} />)
 expect(nodeNames()).toContain('나')
 expect(nodeNames()).not.toContain('라')
 expect(fg.methods.centerAt).toHaveBeenCalled()
})

it('필터 칸: 관계 종류 체크박스(개수와 함께)는 편집기가 준 상태를 따르고, 12종을 넘으면 상위만 보이고 나머지는 기타로 묶이며 검색으로 모두 찾는다. 필터 초기화 버튼이 있다', () => {
 const kinds = Array.from({ length: 20 }, (_, i) => ({ name: '종류' + i, count: 40 - i }))
 const onToggleKind = vi.fn(), onReset = vi.fn()
 render(<Graph rows={triangle().rows} editing={actions()} filter={filters({ kinds, hiddenKinds: new Set(['종류1']), onToggleKind, onReset })} />)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const panel = within(screen.getByRole('group', { name: '그래프 설정' }))
 const labels = () => panel.getAllByRole('checkbox').map((b) => b.parentElement!.textContent!.trim())
 expect(labels()).toEqual(expect.arrayContaining(['종류0 40', '종류1 39', '종류11 29', '기타 8종 196']))
 expect(labels()).not.toContain('종류12 28')
 expect((panel.getByRole('checkbox', { name: '종류1 39' }) as HTMLInputElement).checked).toBe(false)
 fireEvent.click(panel.getByRole('checkbox', { name: '종류0 40' }))
 expect(onToggleKind).toHaveBeenLastCalledWith(['종류0'])
 fireEvent.click(panel.getByRole('checkbox', { name: '기타 8종 196' }))
 expect(onToggleKind).toHaveBeenLastCalledWith(['종류12', '종류13', '종류14', '종류15', '종류16', '종류17', '종류18', '종류19'])
 fireEvent.change(panel.getByRole('searchbox', { name: '관계 종류 찾기' }), { target: { value: '종류15' } })
 expect(labels().filter((l) => /^종류|^기타/.test(l))).toEqual(['종류15 25']) // 검색 중에는 맞는 종류만(상위·기타 없음)
 fireEvent.click(panel.getByRole('checkbox', { name: '종류15 25' }))
 expect(onToggleKind).toHaveBeenLastCalledWith(['종류15'])
 fireEvent.click(panel.getByRole('button', { name: '필터 초기화' }))
 expect(onReset).toHaveBeenCalledTimes(1)
})

it('노드 중심 보기: 노드 메뉴가 편집기에 중심을 알리고, 중심 칩의 전체 보기·Esc가 풀며, 패널의 깊이 버튼이 깊이를 바꾼다', () => {
 const { rows, a } = triangle(), editing = actions(), onDepth = vi.fn(), onClearCenter = vi.fn()
 const view = render(<Graph rows={rows} editing={editing} filter={filters({ onDepth, onClearCenter })} />)
 act(() => props().onNodeRightClick(nodeOf('가람'), mouse()))
 fireEvent.click(menuItem('이 설정 중심으로 보기'))
 expect(editing.onCenter).toHaveBeenCalledWith(a.item.id)
 expect(screen.queryByRole('group', { name: '노드 중심 보기' })).toBeNull()
 view.rerender(<Graph rows={rows} editing={editing} filter={filters({ center: { id: a.item.id, name: '가람', depth: 1 }, onDepth, onClearCenter })} />)
 const chip = screen.getByRole('group', { name: '노드 중심 보기' })
 expect(chip.textContent).toBe('가람 중심 · 깊이 1 · 전체 보기')
 fireEvent.click(within(chip).getByRole('button', { name: '전체 보기' }))
 expect(onClearCenter).toHaveBeenCalledTimes(1)
 fireEvent.keyDown(root(), { key: 'Escape' })
 expect(onClearCenter).toHaveBeenCalledTimes(2)
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 const panel = within(screen.getByRole('group', { name: '그래프 설정' }))
 expect(panel.getByRole('button', { name: '깊이 1' }).getAttribute('aria-pressed')).toBe('true')
 fireEvent.click(panel.getByRole('button', { name: '깊이 2' }))
 expect(onDepth).toHaveBeenCalledWith(2)
})

it('고정한 강조를 먼저 풀고(Esc), 그다음 Esc가 노드 중심 보기를 푼다', () => {
 const { rows, a } = triangle(), onClearCenter = vi.fn()
 render(<Graph rows={rows} editing={actions()} filter={filters({ center: { id: a.item.id, name: '가람', depth: 1 }, onClearCenter })} />)
 act(() => props().onNodeClick(nodeOf('가람'), mouse()))
 fireEvent.keyDown(root(), { key: 'Escape' })
 expect(onClearCenter).not.toHaveBeenCalled() // 고정만 풀린다
 fireEvent.keyDown(root(), { key: 'Escape' })
 expect(onClearCenter).toHaveBeenCalledTimes(1)
})

it('같은 두 설정 사이에 관계가 여럿이면 선 클릭이 관계 목록 메뉴를 열고 고른 관계의 편집 시트로 가며(하나뿐이면 바로), 선에 올리면 첫 관계 외 N개가 보이고, Delete는 지울 관계를 목록에서 고르게 한다', () => {
 const { rows } = triangle(), editing = actions()
 render(<Graph rows={rows} editing={editing} />)
 const pair = linkOf('가람', '나래')
 act(() => props().onLinkClick(pair, mouse(30, 40)))
 expect(editing.onRelation).not.toHaveBeenCalled()
 const items = within(screen.getByRole('menu', { name: '관계 선택' })).getAllByRole('menuitem')
 expect(items.map((i) => i.textContent)).toEqual(['가람 ↔ 나래 · 친구', '나래 → 가람 · 신뢰'])
 fireEvent.click(items[1])
 expect(editing.onRelation).toHaveBeenCalledWith(pair.relations[1].id)
 expect(screen.queryByRole('menu')).toBeNull()
 spread()
 act(() => props().onLinkHover(pair, null))
 expect(shows('친구 외 1개')).toBe(true) // 합친 선의 개수는 이름으로만 알린다
 fireEvent.keyDown(root(), { key: 'Delete' })
 expect(editing.onDeleteRelation).not.toHaveBeenCalled() // 어느 관계인지 목록에서 고른다
 fireEvent.click(within(screen.getByRole('menu', { name: '삭제할 관계 선택' })).getAllByRole('menuitem')[0])
 expect(editing.onDeleteRelation).toHaveBeenCalledWith(pair.relations[0].id)
})

it('큰 세계관(보이는 노드 150개 초과)은 물리를 2초 안에 식힌다. 작은 세계관은 기본값이다', () => {
 render(<Graph rows={ringOf(160)} editing={actions()} />)
 expect(data().nodes).toHaveLength(160)
 expect(props().cooldownTime).toBeLessThanOrEqual(2000)
 expect(props().d3AlphaDecay).toBeGreaterThan(0.0228)
 cleanup()
 render(<Graph rows={triangle().rows} editing={actions()} />)
 expect(props().cooldownTime).toBe(15000)
 expect(props().d3AlphaDecay).toBe(0.0228)
})

it('상자 크기가 바뀌면(사이드바 접기·AI 채팅 열기·창 크기) 캔버스 크기를 다시 재서 넘기고, 사용자가 움직이지 않았으면 다시 맞춘다', () => {
 render(<Graph rows={triangle().rows} editing={actions()} />)
 act(() => props().onEngineStop()) // 처음 맞춤이 끝났다
 fg.methods.zoomToFit.mockClear()
 canvasSize.w = 500; canvasSize.h = 420
 act(() => notifyResize())
 expect([props().width, props().height]).toEqual([500, 420])
 expect(fg.methods.zoomToFit).toHaveBeenCalled()
 fireEvent.pointerDown(screen.getByRole('img', { name: /^관계도/ }), { pointerType: 'mouse' }) // 사용자가 움직였다
 fg.methods.zoomToFit.mockClear()
 canvasSize.w = 900
 act(() => notifyResize())
 expect(props().width).toBe(900)
 expect(fg.methods.zoomToFit).not.toHaveBeenCalled()
})

it('노드가 60개 이하인 작은 세계는 위성을 접지 않는다(두 설정을 이으면 한쪽이 사라지지 않게): 패널이 이유를 알리고 모두 펼치기는 없다', () => {
 render(<Graph rows={hubWorld(0).rows} editing={actions()} />)
 expect(nodeNames()).toEqual(['해그리드', '가', '나', '다', '허브2', '라'])
 expect(screen.getByRole('img', { name: '관계도: 설정 6개 · 관계 5개' })).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: '그래프 설정' }))
 expect(screen.getByText('설정이 많을 때(60개 초과) 접혀요')).toBeTruthy()
 expect(screen.queryByRole('button', { name: '모두 펼치기' })).toBeNull()
})

it('노드가 정확히 60개일 때 설정을 더해 61개(큰 세계관)가 돼도 새 설정은 외톨이로 숨겨지지 않고 선택·강조된다', () => {
 const marked = vi.fn()
 function Live() {
  const [rows, setRows] = useState<Rows>(() => ringOf(60))
  return <Graph rows={rows} editing={actions({ onMark: marked, onAdd: () => { const added = newSetting('people'); added.item.title = '새 인물'; setRows((all) => [...all, added]); return added.item.id } })} />
 }
 render(<Live />)
 expect(nodeNames()).toHaveLength(60) // 60개 이하라 외톨이 숨김은 아직 자동으로 꺼져 있다
 fireEvent.click(screen.getByRole('button', { name: '+ 설정 추가' }))
 fireEvent.click(within(screen.getByRole('dialog', { name: '설정 추가' })).getByRole('button', { name: '인물' }))
 expect(nodeNames()).toContain('새 인물')
 expect(marked).toHaveBeenCalledTimes(1)
})
