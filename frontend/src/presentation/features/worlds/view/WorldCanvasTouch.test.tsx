// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { PublicWorld, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { buildWorldAtlas, type AtlasNode } from '../worldAtlas'
import { buildSettingGraph, type DetailNode } from '../worldDetail'
import WorldAtlasCanvas from './WorldAtlasCanvas'
import WorldGraphCanvas from './WorldGraphCanvas'

// 실제 react-force-graph(d3·canvas)는 그리지 않고 캔버스가 넘기는 값만 붙잡는다.
type GraphProps = { enablePanInteraction?: boolean; enableNodeDrag?: boolean; onNodeHover?: unknown; onNodeClick: (node: unknown) => void }
const forceGraph = vi.hoisted(() => ({ props: null as null | GraphProps }))
vi.mock('react-force-graph-2d', () => ({ default: (props: GraphProps) => { forceGraph.props = props; return null } }))

// jsdom에는 ResizeObserver·matchMedia가 없다. 터치 기기(거친 포인터)인지만 답하는 대역을 둔다.
const media = (coarse: boolean) => Object.defineProperty(window, 'matchMedia', {
  configurable: true, value: (query: string) => ({ matches: coarse && query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }),
})
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'matchMedia'); forceGraph.props = null })

const summary = (id: string, name: string): PublicWorldSummary => ({ id, name, description: '', genre: 'fantasy', authorNickname: '작가', cardCount: 2, relationshipCount: 0, publishedAt: '2026-11-01T00:00:00Z' })
const atlas = () => buildWorldAtlas([summary('w-1', '별빛 세계'), summary('w-2', '안개 항구')])
const world: PublicWorld = {
  id: 'w-1', name: '별빛 세계', description: '', genre: 'fantasy', authorNickname: '작가', publishedAt: '2026-11-01T00:00:00Z', revisionNo: 1, relationshipStatus: 'current',
  cards: [{ id: 'c-1', title: '리안', text: '', cardType: 'character', aliases: [], tags: [] }], relationships: [],
}
const click = (node: unknown) => act(() => forceGraph.props!.onNodeClick(node))
const note = () => document.querySelector('.atlas-note')!.textContent

it('터치 기기의 세계관 지도는 지도 이동·노드 끌기를 끄고, 세계관 노드는 첫 탭에 이름을 알린 뒤 다음 탭에 연다', () => {
  media(true)
  const onOpen = vi.fn<(node: AtlasNode) => void>()
  const data = atlas()
  render(<WorldAtlasCanvas atlas={data} onOpen={onOpen} />)
  expect([forceGraph.props!.enablePanInteraction, forceGraph.props!.enableNodeDrag, forceGraph.props!.onNodeHover]).toEqual([false, false, undefined])
  expect(note()).toContain('노드를 누르면 이름, 한 번 더 누르면 열려요')
  expect(note()).toContain('화살표 버튼으로 지도 이동') // 끌어서 옮길 수 없으니 옮기는 방법을 알린다
  expect(note()).not.toContain('휠')
  expect(screen.getByRole('group', { name: '지도 이동' }).querySelectorAll('button')).toHaveLength(4)
  const target = data.nodes.find((n) => n.kind === 'world' && n.name === '안개 항구')!
  click(target)
  expect(onOpen).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toBe('한 번 더 누르면 열려요 · 안개 항구')
  click(target)
  expect(onOpen.mock.calls).toEqual([[target]])
  // 이름이 늘 보이는 장르 노드는 바로 연다.
  const genre = data.nodes.find((n) => n.kind === 'genre')!
  click(genre)
  expect(onOpen).toHaveBeenLastCalledWith(genre)
})

it('마우스의 세계관 지도는 지도 이동·노드 끌기와 올리기를 그대로 쓰고 노드를 누르면 바로 연다', () => {
  media(false)
  const onOpen = vi.fn<(node: AtlasNode) => void>()
  const data = atlas()
  render(<WorldAtlasCanvas atlas={data} onOpen={onOpen} />)
  expect([forceGraph.props!.enablePanInteraction, forceGraph.props!.enableNodeDrag, typeof forceGraph.props!.onNodeHover]).toEqual([true, true, 'function'])
  expect(note()).toContain('노드에 올리면 이름 · Ctrl(⌘)+휠로 확대')
  const target = data.nodes.find((n) => n.kind === 'world')!
  click(target)
  expect(onOpen.mock.calls).toEqual([[target]])
})

it('터치 기기의 상세 그래프도 지도 이동·노드 끌기를 끄고, 이름이 늘 보이는 노드는 한 번 눌러 연다', () => {
  media(true)
  const onOpen = vi.fn<(node: DetailNode) => void>()
  const data = buildSettingGraph(world)
  render(<WorldGraphCanvas data={data} mode="setting" summary="그래프" onOpen={onOpen} />)
  expect([forceGraph.props!.enablePanInteraction, forceGraph.props!.enableNodeDrag, forceGraph.props!.onNodeHover]).toEqual([false, false, undefined])
  expect(note()).toContain('노드를 누르면 설정 페이지로')
  expect(note()).toContain('화살표 버튼으로 이동')
  expect(note()).not.toContain('휠')
  expect(screen.getByRole('group', { name: '지도 이동' }).querySelectorAll('button')).toHaveLength(4)
  const card = data.nodes.find((n) => n.kind === '인물')!
  click(card)
  expect(onOpen.mock.calls).toEqual([[card]])
})
