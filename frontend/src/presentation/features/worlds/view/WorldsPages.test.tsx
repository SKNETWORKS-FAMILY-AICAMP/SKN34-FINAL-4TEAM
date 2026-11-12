// @vitest-environment jsdom
import '../../../../test/fixtureApp' // appContainer보다 먼저: 공개 세계관은 서버 대신 메모리 데모 저장소를 쓴다
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { DEMO_WORLDS } from '../../../../data/mock/demoPublicWorlds'
import { InMemoryPublicWorldRepository } from '../../../../data/mock/InMemoryPublicWorldRepository'
import type { PublicWorld, PublicWorldPage, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { CARD_COLORS } from '../../../shared/worldBoard'
import { WORLD_GENRES } from '../../../shared/worldGenres'
import { buildWorldAtlas, rankByLineage, type AtlasNode, type WorldAtlas } from '../worldAtlas'
import { bookPath, cardPath, type DetailGraph, type DetailNode } from '../worldDetail'
import { WorldCardPage } from './WorldCardPage'
import { WorldDetailPage, WorldsPage } from './WorldsPages'

// 실제 그래프(react-force-graph)는 렌더하지 않고 화면이 캔버스에 넘기는 값만 붙잡는다.
const canvas = vi.hoisted(() => ({ props: null as null | { atlas: WorldAtlas; lit?: ReadonlySet<string>; onOpen: (node: AtlasNode) => void } }))
vi.mock('./WorldAtlasCanvas', () => ({
  default: (props: NonNullable<typeof canvas.props>) => {
    canvas.props = props
    return <div>지도 캔버스</div>
  },
}))

// 상세의 설정 그래프·인물관계도 캔버스도 마찬가지다.
const graph = vi.hoisted(() => ({ props: null as null | { data: DetailGraph; mode: string; summary: string; onOpen: (node: DetailNode) => void } }))
vi.mock('./WorldGraphCanvas', () => ({
  default: (props: NonNullable<typeof graph.props>) => {
    graph.props = props
    return <div>그래프 캔버스</div>
  },
}))

afterEach(() => { cleanup(); vi.restoreAllMocks(); canvas.props = null; graph.props = null })

const Pages = () => (
  <Routes>
    <Route path="/worlds" element={<WorldsPage />} />
    <Route path="/worlds/:id" element={<WorldDetailPage />} />
    <Route path="/worlds/:id/cards/:cardId" element={<WorldCardPage />} />
  </Routes>
)
const mount = (path: string, extra?: ReactNode) => render(
  <Provider store={createAppStore()}>
    <MemoryRouter initialEntries={[path]}><Pages />{extra}</MemoryRouter>
  </Provider>,
)
/** 화면이 세계관을 다 읽을 때까지(불러오는 중 안내가 사라질 때까지) 기다린다. 메모리 데모 저장소가 답한다. */
const LOADING = /^(공개 )?세계관( 목록)?을 불러오고 있어요\.$/
const renderAt = async (path: string) => {
  mount(path)
  await waitFor(() => expect(screen.queryByText(LOADING)).toBeNull())
}
const demo = (id: string) => DEMO_WORLDS.find((w) => w.id === id)!
const name = (id: string) => demo(id).name
// 메모리 데모의 세계관 요약 26개(파생·조합과 카드 점이 모두 있다)
const DEMO = (await new InMemoryPublicWorldRepository().list({ page: 0, size: 100 })).items
/** 상세 헤더의 계보 줄들(출처 한 줄, 파생·조합된 세계관 한 줄) */
const lines = () => Array.from(document.querySelectorAll('.worlds-lineage p'), (p) => p.textContent)

it('/worlds는 칩 줄 아래에 홈 상단과 같은 2단(왼쪽 세계관 지도 · 오른쪽 실시간 인기)을 두고 선반은 10개까지, 모아 보기는 전체를 보인다', async () => {
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  const { worlds, cards, derived, combined } = buildWorldAtlas(DEMO).stats
  const main = within(screen.getByRole('main'))
  expect(main.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['STORYFORK 세계관 지도', '실시간 인기', '새로 공개된 세계관', '세계관 모아 보기']) // 서버에 인기 지표가 없어 '인기 세계관' 선반은 없다
  const map = main.getByRole('region', { name: 'STORYFORK 세계관 지도' })
  const rank = main.getByRole('complementary', { name: '실시간 인기 세계관' })
  expect(map.parentElement).toBe(rank.parentElement)
  expect(map.parentElement?.className).toBe('herow')
  // 통계 줄과 범례는 지도 카드 안에 있다
  expect(within(map).getByText(`공개 세계관 ${worlds}개 · 설정 카드 ${cards}개 · 파생 ${derived} · 조합 ${combined}`)).toBeTruthy()
  const legend = within(within(map).getByRole('group', { name: '지도 범례' }))
  const items = (name: string) => legend.getByRole('list', { name }).textContent
  expect([items('장르 색'), items('설정 카드 유형 색'), items('연결 선')]).toEqual([WORLD_GENRES.join(''), Object.keys(CARD_COLORS).join(''), '파생조합'])
  const links = (heading: string) => within(screen.getByRole('heading', { name: heading }).closest('section')!).getAllByRole('link')
  expect(links('새로 공개된 세계관')).toHaveLength(10)
  expect(links('세계관 모아 보기')).toHaveLength(DEMO_WORLDS.length)
})

it('실시간 인기 패널은 홈 TOP10과 같은 구조로 파생·조합 순 TOP10을 순위·이름·작가·상세 링크로 보인다', async () => {
  await renderAt('/worlds')
  const rank = within(screen.getByRole('complementary', { name: '실시간 인기 세계관' }))
  const expected = rankByLineage(DEMO)
  expect(rank.getAllByRole('listitem').map((li) => li.textContent)).toEqual(expected.map((w, i) => `${i + 1}${w.name}${w.authorNickname}`))
  expect(rank.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(expected.map((w) => `/worlds/${w.id}`))
  expect(Array.from(screen.getByRole('complementary', { name: '실시간 인기 세계관' }).querySelectorAll('.n'), (n) => n.className)).toEqual([
    'n md md1', 'n md md2', 'n md md3', ...Array<string>(7).fill('n'),
  ])
  expect(rank.getByText('파생·조합 순').className).toBe('live')
})

// jsdom에는 scrollIntoView가 없다
const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView

it('더보기를 누르면 아래 세계관 모아 보기로 내려가고 그곳으로 포커스를 옮긴다', async () => {
  scrollIntoView.mockClear()
  await renderAt('/worlds')
  fireEvent.click(within(screen.getByRole('complementary', { name: '실시간 인기 세계관' })).getByRole('button', { name: '더보기 ›' }))
  const grid = screen.getByRole('heading', { name: '세계관 모아 보기' }).closest('section')
  expect(scrollIntoView).toHaveBeenCalledOnce()
  expect(scrollIntoView.mock.contexts[0]).toBe(grid)
  expect(document.activeElement).toBe(grid)
})

it('장르 칩을 고르면 그 장르로 밝힐 노드를 지도에 넘기고 추천 칩으로 돌아가면 넘기지 않는다', async () => {
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  expect(canvas.props?.lit).toBeUndefined()
  fireEvent.click(screen.getByRole('button', { name: '🛰️ SF' }))
  const { atlas, lit } = canvas.props!
  const idOf = (genre: string) => atlas.nodes.find((n) => n.kind === 'genre' && n.genre === genre)!.id
  expect([lit?.has(idOf('SF')), lit?.has(idOf('무협'))]).toEqual([true, false])
  fireEvent.click(screen.getByRole('button', { name: '추천' }))
  expect(canvas.props?.lit).toBeUndefined()
})

it('지도의 장르 노드를 누르면 그 장르 칩이 골라지고 세계관 노드를 누르면 그 세계관 상세로 간다', async () => {
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  const { atlas, onOpen } = canvas.props!
  act(() => onOpen(atlas.nodes.find((n) => n.kind === 'genre' && n.genre === '무협')!))
  expect(screen.getByRole('button', { name: '⚔️ 무협' }).getAttribute('aria-pressed')).toBe('true')
  act(() => onOpen(atlas.nodes.find((n) => n.kind === 'world' && n.worldId === 'moonhalo-isles')!))
  expect((await screen.findByRole('heading', { level: 1, name: name('moonhalo-isles') })).textContent).toBe(name('moonhalo-isles'))
})

it('지도의 카드 노드를 누르면 그 카드의 페이지로 간다', async () => {
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  const { atlas, onOpen } = canvas.props!
  act(() => onOpen(atlas.nodes.find((n) => n.kind === 'card' && n.worldId === 'moonhalo-isles' && n.name === '새벽항')!))
  expect((await screen.findByRole('heading', { level: 1, name: '새벽항' })).textContent).toBe('새벽항')
  expect(screen.getByRole('link', { name: '← 세계관으로 돌아가기' }).getAttribute('href')).toBe('/worlds/moonhalo-isles?tab=book')
})

it('파생 세계관 상세는 원본 링크 한 줄과 한 줄 소개를 보인다', async () => {
  await renderAt('/worlds/tide-compass?tab=book') // 계보 줄은 설정집의 파생·조합 문단에 있다
  expect(lines()).toEqual([`${name('moonhalo-isles')}에서 파생`, `이 세계관에서 파생·조합된 세계관 1개 · ${name('drowned-lighthouse')}`])
  expect(within(document.querySelector('.worlds-lineage') as HTMLElement).getByRole('link', { name: name('moonhalo-isles') }).getAttribute('href')).toBe('/worlds/moonhalo-isles')
  expect(screen.getByText(demo('tide-compass')!.hook)).toBeTruthy()
})

it('조합 세계관 상세는 원본들을 + 로 이은 한 줄을 보인다', async () => {
  await renderAt('/worlds/regret-bazaar?tab=book')
  expect(lines()).toEqual([`${['dawn-store', 'night-market', 'midnight-theatre'].map(name).join(' + ')} 조합`])
})

it('원본이 쓰인 세계관 상세는 파생·조합된 세계관 수와 링크를 보인다', async () => {
  await renderAt('/worlds/moonhalo-isles?tab=book')
  expect(lines()).toEqual([`이 세계관에서 파생·조합된 세계관 2개 · ${name('tide-compass')}, ${name('star-tide-station')}`])
  expect(within(document.querySelector('.worlds-lineage') as HTMLElement).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/worlds/tide-compass', '/worlds/star-tide-station'])
})

it('없는 세계관 주소는 찾을 수 없다고 알린다', async () => {
  await renderAt('/worlds/없는-세계관')
  expect(screen.getByRole('heading', { level: 1, name: '찾을 수 없는 세계관' })).toBeTruthy()
  expect(lines()).toEqual([])
})

// ── 상세 탭(설정 그래프 · 인물관계도 · 설정집) ──
const tabs = () => screen.getAllByRole('tab')
const selectedTab = () => tabs().filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent)
/** 주소 검색어(?tab)와 이동 방식(POP·PUSH·REPLACE)을 화면 밖에서 읽는다. */
const Where = () => <p data-testid="where" data-nav={useNavigationType()}>{useLocation().search}</p>
const trackedAt = async (path: string) => {
  mount(path, <Where />)
  await waitFor(() => expect(screen.queryByText(LOADING)).toBeNull())
}

it('상세는 설정 그래프·인물관계도·설정집을 tablist로 두고 기본은 설정 그래프이며 예전 관계도 비공개 문구는 없다', async () => {
  await renderAt('/worlds/moonhalo-isles')
  const tablist = screen.getByRole('tablist', { name: '세계관 상세 탭' })
  expect(within(tablist).getAllByRole('tab').map((t) => t.textContent)).toEqual(['설정 그래프', '인물관계도', '설정집'])
  expect(selectedTab()).toEqual(['설정 그래프'])
  // 선택한 탭만 Tab 순서에 들어가고 패널은 선택한 탭이 이름을 붙인다
  expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1])
  const panel = screen.getByRole('tabpanel')
  expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[0].id)
  expect(tabs().every((t) => t.getAttribute('aria-controls') === panel.id)).toBe(true)
  await screen.findByText('그래프 캔버스')
  expect(graph.props?.mode).toBe('setting')
  expect(document.body.textContent).not.toContain('관계도는 공개하지 않아요')
  screen.getByText('데모 · 공개 세계관과 세계관 지도는 서버 연결 전이에요')
})

it('?tab 값으로 탭을 열고 모르는 값은 설정 그래프로 연다', async () => {
  for (const [query, expected] of [['people', '인물관계도'], ['book', '설정집'], ['graph', '설정 그래프'], ['nope', '설정 그래프']]) {
    await renderAt(`/worlds/moonhalo-isles?tab=${query}`)
    expect(selectedTab(), query).toEqual([expected])
    cleanup()
  }
})

it('탭을 누르면 ?tab에 남고 기록을 쌓지 않는다(뒤로 가기로 탭을 되짚지 않는다)', async () => {
  await trackedAt('/worlds/moonhalo-isles')
  const where = () => screen.getByTestId('where')
  expect([where().textContent, where().dataset.nav]).toEqual(['', 'POP'])
  fireEvent.click(screen.getByRole('tab', { name: '인물관계도' }))
  await waitFor(() => expect(selectedTab()).toEqual(['인물관계도']))
  expect([where().textContent, where().dataset.nav]).toEqual(['?tab=people', 'REPLACE'])
})

it('좌우 화살표·Home·End로 탭을 옮기고 끝에서는 돌아서 이어지며 옮긴 탭이 포커스를 받는다', async () => {
  await renderAt('/worlds/moonhalo-isles')
  const press = async (key: string, expected: string) => {
    fireEvent.keyDown(document.activeElement!, { key })
    await waitFor(() => expect(selectedTab(), key).toEqual([expected]))
    expect(document.activeElement?.textContent, key).toBe(expected)
  }
  tabs()[0].focus()
  await press('ArrowRight', '인물관계도')
  await press('ArrowRight', '설정집')
  await press('ArrowRight', '설정 그래프')
  await press('ArrowLeft', '설정집')
  await press('Home', '설정 그래프')
  await press('End', '설정집')
})

it('설정 그래프는 카드·연결 수와 범례를 보이고 카드 노드와 세계관 중심 노드를 그래프에 넘긴다', async () => {
  await renderAt('/worlds/moonhalo-isles')
  await screen.findByText('그래프 캔버스')
  const { data, summary } = graph.props!
  expect(data.nodes.map((n) => n.name)).toEqual([...demo('moonhalo-isles')!.cards.map((c) => c.title), '달무리 군도'])
  expect(summary).toBe('달무리 군도의 설정 카드 7개가 8개의 연결로 이어진 그래프')
  const region = within(screen.getByRole('region', { name: '설정 그래프' }))
  region.getByText('설정 카드 7개 · 연결 8개')
  expect(region.getByRole('list', { name: '그래프 노드 색' }).textContent).toBe('세계관인물장소규칙사건기타')
})

it('인물관계도 탭은 데모 표시와 함께 인물만 노드로, 인물끼리의 관계를 라벨 있는 선으로 그래프에 넘긴다', async () => {
  await renderAt('/worlds/moonhalo-isles?tab=people')
  await screen.findByText('그래프 캔버스')
  screen.getByText('데모 · 공개 범위 확정 전')
  const { data, mode, summary } = graph.props!
  expect(mode).toBe('people')
  expect(data.nodes.map((n) => n.name)).toEqual(['조석신 하엘', '늙은 항해사 오르', '견습 항해사 미라'])
  expect(data.links.map((l) => l.label).toSorted()).toEqual(['숭배', '스승-제자', '의심'])
  expect(summary).toBe('달무리 군도의 인물 3명이 3개의 관계로 이어진 관계도')
  within(screen.getByRole('region', { name: '인물관계도' })).getByText('인물 3명 · 관계 3개')
})

it('인물이 2명 미만인 세계관은 인물관계도 대신 빈 상태 문구를 보이고 그래프를 만들지 않는다', async () => {
  for (const [id, count] of [['orbit-graveyard', 0], ['green-ring', 1]] as const) {
    await renderAt(`/worlds/${id}?tab=people`)
    screen.getByText('데모 · 공개 범위 확정 전')
    screen.getByText(`인물이 2명 이상 공개돼야 인물관계도를 보여 줄 수 있어요. 이 세계관에는 지금 공개된 인물이 ${count}명이에요.`)
    expect(screen.queryByRole('region', { name: '인물관계도' }), id).toBeNull()
    expect(graph.props, id).toBeNull()
    cleanup()
  }
})

it('그래프 노드를 누르면 그 카드의 페이지로 가고 세계관 중심 노드는 설정집 탭으로 간다', async () => {
  await renderAt('/worlds/moonhalo-isles')
  await screen.findByText('그래프 캔버스')
  const node = (name: string) => graph.props!.data.nodes.find((n) => n.name === name)!
  act(() => graph.props!.onOpen(node('달무리 군도')))
  await waitFor(() => expect(selectedTab()).toEqual(['설정집']))
  fireEvent.click(screen.getByRole('tab', { name: '설정 그래프' }))
  await screen.findByText('그래프 캔버스')
  act(() => graph.props!.onOpen(node('새벽항')))
  expect((await screen.findByRole('heading', { level: 1, name: '새벽항' })).textContent).toBe('새벽항')
})

it('인물관계도의 인물 노드를 눌러도 그 인물의 카드 페이지로 간다', async () => {
  await renderAt('/worlds/moonhalo-isles?tab=people')
  await screen.findByText('그래프 캔버스')
  act(() => graph.props!.onOpen(graph.props!.data.nodes.find((n) => n.name === '견습 항해사 미라')!))
  expect((await screen.findByRole('heading', { level: 1, name: '견습 항해사 미라' })).textContent).toBe('견습 항해사 미라')
})

it('상세 위쪽은 제목·한 줄 소개·작가만 두고 표지와 설명은 설정집의 정보 상자·개요가 맡는다', async () => {
  await renderAt('/worlds/moonhalo-isles')
  const world = demo('moonhalo-isles')!
  const head = document.querySelector<HTMLElement>('.worlds-head')!
  expect(head.textContent).toBe(`${world.name}${world.hook}작가 ${world.author} · 읽기 전용`)
  expect(head.querySelector('.cov')).toBeNull()
  expect(screen.getByRole('tabpanel').querySelector('.cov')).toBeNull() // 하단 작품·연결된 세계관 선반의 표지는 탭 영역 밖이다
  expect(screen.queryByText(world.description)).toBeNull()
  cleanup()
  await renderAt('/worlds/moonhalo-isles?tab=book')
  expect(document.querySelector('.nw-info .cov')).not.toBeNull()
  screen.getByText(world.description)
})

// ── 설정집 탭: 게시판(왼쪽 분류 메뉴 + 오른쪽 표) ──
const panel = () => within(screen.getByRole('tabpanel'))
const board = () => within(panel().getByRole('table', { name: '설정 카드 목록' }))
const boardRows = () => board().getAllByRole('row').slice(1) // 머리 행 제외
const rowTitles = () => boardRows().map((r) => within(r).getByRole('link').textContent)
const menu = () => within(panel().getByRole('navigation', { name: '설정 분류' }))

it('설정집은 한 줄 요약 아래 왼쪽 분류 메뉴와 오른쪽 게시판 표를 두고 세계관 개요(정보 상자·표지·계보)는 표 아래에 한 번만 둔다', async () => {
  await renderAt('/worlds/moonhalo-isles?tab=book')
  panel().getByText('판타지 · 작가 달무리 · 설정 카드 7개 · 파생·조합된 세계관 2개')
  // 분류 메뉴: 전체와 카드가 있는 유형, 선택은 aria-current
  expect(menu().getAllByRole('link').map((a) => [a.textContent, a.getAttribute('aria-current')])).toEqual([
    ['전체 7', 'page'], ['인물 3', null], ['장소 1', null], ['규칙 1', null], ['사건 1', null], ['기타 1', null],
  ])
  expect(menu().getByRole('link', { name: '인물 3' }).getAttribute('href')).toBe(bookPath('moonhalo-isles', '인물'))
  // 게시판 표: 시맨틱 머리 열과 카드마다 한 줄
  const heads = board().getAllByRole('columnheader')
  expect([heads.map((h) => h.textContent), heads.every((h) => h.getAttribute('scope') === 'col')]).toEqual([['번호', '분류', '제목', '요약', '연결'], true])
  expect(rowTitles()).toEqual(['조석신 하엘', '늙은 항해사 오르', '견습 항해사 미라', '새벽항', '금기 · 해도를 베끼지 않는다', '일곱 번째 섬의 실종', '우주관 · 물때의 달'])
  // 정보 상자·표지는 표 아래 개요에 한 번만 있다(옛 분류 상자·번호 목차·문단 문서는 없다)
  const info = screen.getByRole('table', { name: '달무리 군도' })
  expect(document.querySelectorAll('.nw-info')).toHaveLength(1)
  expect(screen.getByRole('table', { name: '설정 카드 목록' }).compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(info).getAllByRole('rowheader').map((e) => e.textContent)).toEqual(['장르', '작가', '설정 카드', '파생·조합된 세계관'])
  expect(within(info).getAllByRole('cell').slice(1).map((e) => e.textContent)).toEqual(['판타지', '달무리', '7개', '2개'])
  expect(screen.queryByRole('navigation', { name: '목차' })).toBeNull()
  expect(document.querySelector('.nw-cat')).toBeNull()
})

it('게시판 줄은 번호·분류·제목(관계·연결 수)·요약·연결 수를 보이고 제목 링크 하나가 카드 페이지로 가는 주 링크다', async () => {
  await renderAt('/worlds/moonhalo-isles?tab=book')
  const row = (title: string) => screen.getByRole('link', { name: title }).closest('tr')!
  const sailor = row('늙은 항해사 오르')
  expect(Array.from(sailor.cells, (c) => c.textContent)).toEqual([
    '2', '인물', '늙은 항해사 오르[2]관계 2개', '기억에 항로를 적는 마지막 항해사. 일곱 번째 섬의 항로를 혼자 기억한다고 한다.', '3',
  ])
  expect(within(sailor).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([cardPath('moonhalo-isles', 2)])
  // 인물이 아닌 줄의 제목 옆 수는 연결 수다
  expect(Array.from(row('새벽항').cells, (c) => c.textContent).filter((_, i) => i !== 3)).toEqual(['4', '장소', '새벽항[2]연결 2개', '2'])
  fireEvent.click(within(sailor).getByRole('link'))
  expect((await screen.findByRole('heading', { level: 1, name: '늙은 항해사 오르' })).textContent).toBe('늙은 항해사 오르')
})

it('이어진 카드가 없는 줄은 제목 옆 수를 달지 않고 연결 0이다', async () => {
  await renderAt('/worlds/orbit-graveyard?tab=book')
  expect(boardRows().map((r) => Array.from((r as HTMLTableRowElement).cells, (c) => c.textContent).filter((_, i) => i !== 3))).toEqual([
    ['1', '장소', '무덤 궤도', '0'], ['2', '규칙', '관제 협정 · 잔해는 건드리지 않는다', '0'], ['3', '사건', '31번 정거장의 점등', '0'],
  ])
})

it('분류 메뉴를 누르면 그 유형만 보이고 ?type에 남으며(기록을 쌓지 않음) 전체로 돌아가면 ?type이 사라진다', async () => {
  await trackedAt('/worlds/moonhalo-isles?tab=book')
  const where = () => new URLSearchParams(screen.getByTestId('where').textContent ?? '')
  fireEvent.click(menu().getByRole('link', { name: '인물 3' }))
  await waitFor(() => expect(where().get('type')).toBe('인물'))
  expect([where().get('tab'), screen.getByTestId('where').dataset.nav]).toEqual(['book', 'REPLACE'])
  expect(menu().getAllByRole('link').map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null, null, null, null])
  expect(rowTitles()).toEqual(['조석신 하엘', '늙은 항해사 오르', '견습 항해사 미라'])
  expect(boardRows().map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['1', '2', '3'])
  panel().getByText('설정 3개')
  fireEvent.click(menu().getByRole('link', { name: '전체 7' }))
  await waitFor(() => expect(where().get('type')).toBeNull())
  expect(rowTitles()).toHaveLength(7)
})

it('?type으로 열면 그 분류가 골라져 있고 그 세계관에 카드가 없는 유형은 전체로 연다', async () => {
  await renderAt('/worlds/moonhalo-isles?tab=book&type=장소')
  expect(rowTitles()).toEqual(['새벽항'])
  expect(menu().getByRole('link', { name: '장소 1' }).getAttribute('aria-current')).toBe('page')
  cleanup()
  await renderAt('/worlds/moonhalo-isles?tab=book&type=조직')
  expect(menu().getByRole('link', { name: '전체 7' }).getAttribute('aria-current')).toBe('page')
  expect(rowTitles()).toHaveLength(7)
})

it('검색어(제목·본문)와 정렬로 게시판을 바꾸면 결과 수와 순번이 따라오고 맞는 카드가 없으면 안내를 보인다', async () => {
  await renderAt('/worlds/moonhalo-isles?tab=book')
  const search = panel().getByRole('searchbox', { name: '설정 카드 제목·본문 검색' })
  panel().getByText('설정 7개')
  fireEvent.change(search, { target: { value: '항해사' } }) // 제목(오르·미라)과 본문(금기)에 든다
  expect(rowTitles()).toEqual(['늙은 항해사 오르', '견습 항해사 미라', '금기 · 해도를 베끼지 않는다'])
  panel().getByText('설정 3개')
  const sort = panel().getByRole('combobox', { name: '정렬' }) as HTMLSelectElement
  expect(sort.value).toBe('book')
  fireEvent.change(sort, { target: { value: 'name' } })
  expect(sort.value).toBe('name')
  expect(rowTitles()).toEqual(['견습 항해사 미라', '금기 · 해도를 베끼지 않는다', '늙은 항해사 오르'])
  expect(boardRows().map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['1', '2', '3'])
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.change(sort, { target: { value: 'links' } })
  expect(rowTitles()).toEqual(['조석신 하엘', '늙은 항해사 오르', '견습 항해사 미라', '새벽항', '일곱 번째 섬의 실종', '우주관 · 물때의 달', '금기 · 해도를 베끼지 않는다'])
  fireEvent.change(search, { target: { value: '없는 글자' } })
  expect(boardRows().map((r) => r.textContent)).toEqual(['조건에 맞는 설정이 없어요.'])
  panel().getByText('설정 0개')
})

it('정보 상자는 출처에 따라 파생 원본·조합 원본 링크를 보인다', async () => {
  await renderAt('/worlds/tide-compass?tab=book')
  const origin = within(screen.getByRole('table', { name: '조수의 나침반' }))
  expect(origin.getAllByRole('rowheader').map((e) => e.textContent)).toContain('파생 원본')
  expect(origin.getByRole('link', { name: name('moonhalo-isles') }).getAttribute('href')).toBe('/worlds/moonhalo-isles')
  cleanup()
  await renderAt('/worlds/regret-bazaar?tab=book')
  const combined = within(screen.getByRole('table', { name: '후회 장터' }))
  const row = within(combined.getByRole('rowheader', { name: '조합 원본' }).closest('tr')!)
  expect(row.getByRole('cell').textContent).toBe(['dawn-store', 'night-market', 'midnight-theatre'].map(name).join(' + '))
  expect(row.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['dawn-store', 'night-market', 'midnight-theatre'].map((id) => `/worlds/${id}`))
})

// ── 상세 하단: 이 세계관을 쓴 작품 · 연결된 세계관(어느 탭이든 탭 영역 아래에 보인다) ──
const sectionOf = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('section')!

it('상세 하단에는 어느 탭이든 이 세계관을 쓴 작품이 표지·제목·작가·화 수와 데모 작품 표시로 보이고 링크는 없다', async () => {
  for (const tab of ['graph', 'people', 'book']) {
    await renderAt(`/worlds/moonhalo-isles?tab=${tab}`)
    const heading = screen.getByRole('heading', { level: 2, name: '이 세계관을 쓴 작품' })
    expect(screen.getByRole('tabpanel').compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING, tab).toBeTruthy() // 탭 영역 아래
    const works = within(sectionOf('이 세계관을 쓴 작품'))
    expect(works.getAllByRole('heading', { level: 3 }).map((h) => h.textContent), tab).toEqual(['일곱 번째 섬을 찾아서', '기억으로 쓰는 항로'])
    expect(sectionOf('이 세계관을 쓴 작품').querySelectorAll('.cov'), tab).toHaveLength(2)
    expect(works.getAllByText('데모 작품'), tab).toHaveLength(2)
    works.getByText('파도결 · 42화')
    expect(works.queryAllByRole('link'), tab).toEqual([]) // 실제 작품이 아니라 가짜 이동을 만들지 않는다
    cleanup()
  }
})

it('이 세계관으로 쓴 작품이 없으면 빈 상태 안내를 보인다', async () => {
  await renderAt('/worlds/tide-compass')
  const works = within(sectionOf('이 세계관을 쓴 작품'))
  works.getByText('아직 이 세계관으로 쓴 작품이 없어요')
  expect(works.queryAllByRole('heading', { level: 3 })).toEqual([])
})

it('연결된 세계관은 원본과 파생·조합된 세계관을 라벨 칩과 함께 한 선반에 보이고 카드를 누르면 그 세계관 상세로 간다', async () => {
  await renderAt('/worlds/night-market') // 원본 없음, 파생 1(도깨비 다리)과 조합 2(야시의 연인·후회 장터)
  const cards = () => within(sectionOf('연결된 세계관')).getAllByRole('link')
  expect(cards().map((a) => [a.getAttribute('href'), a.querySelector('.lk')?.textContent, a.querySelector('h3')?.textContent])).toEqual([
    ['/worlds/goblin-bridge', '파생', name('goblin-bridge')], ['/worlds/lantern-lovers', '조합', name('lantern-lovers')], ['/worlds/regret-bazaar', '조합', name('regret-bazaar')],
  ])
  cleanup()
  await renderAt('/worlds/tide-compass') // 원본 1(달무리 군도)과 파생 1(가라앉은 등대)
  expect(cards().map((a) => [a.getAttribute('href'), a.querySelector('.lk')?.textContent])).toEqual([['/worlds/moonhalo-isles', '원본'], ['/worlds/drowned-lighthouse', '파생']])
  fireEvent.click(cards()[0])
  expect((await screen.findByRole('heading', { level: 1, name: name('moonhalo-isles') })).textContent).toBe(name('moonhalo-isles'))
})

// ── 실제 모드(서버 응답): 불러오는 중·실패·빈 상태와 서버에 없는 데모 기능 숨김 ──
// 메모리 데모 대신 서버가 줄 모양(데모 표시·계보·작품·카드 점 없음)을 UseCase 대역으로 돌려준다.
const useCase = () => appContainer.resolve('publicWorldUseCase')
const server = (id: string, extra: Partial<PublicWorldSummary> = {}): PublicWorldSummary => ({
  id, name: `${id} 세계`, description: '설명', genre: 'fantasy', authorNickname: '서버 작가', cardCount: 3, relationshipCount: 1, publishedAt: '2026-11-01T00:00:00Z', ...extra,
})
const serverPage = (items: PublicWorldSummary[], total = items.length): PublicWorldPage => ({ items, page: 0, size: 24, total })
const card = (id: string, title: string, cardType: PublicWorld['cards'][number]['cardType']) => ({ id, title, text: `${title} 설명`, cardType, aliases: [], tags: [] })
const serverWorld = (extra: Partial<PublicWorld> = {}): PublicWorld => ({
  id: 'sw', name: '서버 세계', description: '서버 설명', genre: 'sf', authorNickname: '서버 작가', publishedAt: '2026-11-01T00:00:00Z', revisionNo: 2,
  cards: [card('c-1', '하린', 'character'), card('c-2', '도윤', 'character'), card('c-3', '온실', 'location')],
  relationships: [{ id: 'r-1', sourceCardId: 'c-1', targetCardId: 'c-2', label: '적대' }, { id: 'r-2', sourceCardId: 'c-1', targetCardId: 'c-3', label: '거점' }],
  relationshipStatus: 'current', ...extra,
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const coverSrc = (root: ParentNode = document) => Array.from(root.querySelectorAll('.cov img'), (img) => img.getAttribute('src'))

it('hasCover인 서버 세계관은 목록 카드가 공개 cover 주소의 이미지를 쓰고 없는 세계관은 자동 생성 표지를 쓴다', async () => {
  vi.spyOn(useCase(), 'list').mockResolvedValue(serverPage([server('a', { hasCover: true }), server('b')]))
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  expect(new Set(coverSrc())).toEqual(new Set(['/api/v1/public/world-studios/a/cover']))
  const b = screen.getAllByRole('heading', { level: 3, name: 'b 세계' })[0].closest('a')!
  expect(b.querySelector('.cov svg')).not.toBeNull() // 표지가 없으면 기존 자동 생성 표지
  expect(b.querySelector('.cov img')).toBeNull()
})

it('hasCover인 서버 세계관의 상세는 정보 상자 표지가 공개 cover 이미지이고 없으면 자동 생성 표지다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld({ hasCover: true }))
  await renderAt('/worlds/sw?tab=book')
  expect(coverSrc()).toEqual(['/api/v1/public/world-studios/sw/cover'])
  cleanup()
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld())
  await renderAt('/worlds/sw?tab=book')
  expect(coverSrc()).toEqual([])
  expect(document.querySelector('.nw-cover .cov svg')).not.toBeNull()
})

it('목록을 읽는 동안 불러오는 중 안내만 보이고(칩은 늘 보인다) 끝나면 지도·순위·선반을 보인다', async () => {
  const wait = deferred<PublicWorldPage>()
  vi.spyOn(useCase(), 'list').mockReturnValue(wait.promise)
  mount('/worlds')
  screen.getByText('공개 세계관을 불러오고 있어요.')
  expect(screen.queryByText('지도 캔버스')).toBeNull()
  screen.getByRole('button', { name: '추천' })
  await act(async () => wait.resolve(serverPage([server('a'), server('b')])))
  await screen.findByText('지도 캔버스')
  expect(screen.queryByText(LOADING)).toBeNull()
})

it('목록 조회가 실패하면 빈 목록으로 숨기지 않고 실패 안내와 다시 시도를 보이며 누르면 다시 읽는다', async () => {
  const list = vi.spyOn(useCase(), 'list').mockRejectedValue(new Error('offline'))
  mount('/worlds')
  expect((await screen.findByRole('alert')).textContent).toContain('공개 세계관을 불러오지 못했어요.')
  expect(screen.queryByText('지도 캔버스')).toBeNull()
  expect(screen.queryByText(/아직 공개된 세계관이 없어요/)).toBeNull()
  list.mockResolvedValue(serverPage([server('a')]))
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('지도 캔버스')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('공개된 세계관이 하나도 없으면 서재에서 공개하라는 안내와 /lib?tab=worlds 링크를 보인다', async () => {
  vi.spyOn(useCase(), 'list').mockResolvedValue(serverPage([]))
  await renderAt('/worlds')
  screen.getByText('아직 공개된 세계관이 없어요 · 내 서재에서 세계관을 공개해 보세요')
  expect(screen.getByRole('link', { name: '내 서재의 세계관으로 가기' }).getAttribute('href')).toBe('/lib?tab=worlds')
  expect(screen.queryByText('지도 캔버스')).toBeNull()
  expect(screen.queryByText(/데모/)).toBeNull()
})

it('서버 목록은 데모 안내·카드 유형·연결 선 범례·파생·조합 통계 없이 장르→세계관 지도와 최근 공개 순 순위를 보인다', async () => {
  const items = [
    server('old', { publishedAt: '2026-11-01T00:00:00Z', cardCount: 2 }), server('new', { publishedAt: '2026-11-09T00:00:00Z', cardCount: 9, genre: 'sf' }),
    server('mid', { publishedAt: '2026-11-05T00:00:00Z', genre: null }),
  ]
  vi.spyOn(useCase(), 'list').mockResolvedValue(serverPage(items))
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  expect(screen.queryByText(/데모/)).toBeNull()
  const main = within(screen.getByRole('main'))
  expect(main.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['STORYFORK 세계관 지도', '실시간 인기', '새로 공개된 세계관', '세계관 모아 보기'])
  const map = within(main.getByRole('region', { name: 'STORYFORK 세계관 지도' }))
  map.getByText('공개 세계관 3개 · 설정 카드 14개')
  expect(map.getByRole('list', { name: '장르 색' }).textContent).toBe(WORLD_GENRES.join(''))
  expect(map.queryByRole('list', { name: '설정 카드 유형 색' })).toBeNull()
  expect(map.queryByRole('list', { name: '연결 선' })).toBeNull()
  expect(canvas.props!.atlas.nodes.map((n) => n.kind)).not.toContain('card') // 카드 점 없이 장르·세계관 노드만
  const rank = within(main.getByRole('complementary', { name: '실시간 인기 세계관' }))
  expect(rank.getByText('최근 공개 순').className).toBe('live')
  expect(rank.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1new 세계서버 작가', '2mid 세계서버 작가', '3old 세계서버 작가'])
})

it('장르 칩을 고르면 그 장르 코드로 모아 보기를 다시 읽고 지도·순위는 그대로이며 추천 칩은 장르 없이 읽는다', async () => {
  const list = vi.spyOn(useCase(), 'list').mockImplementation(async ({ genre } = {}) => serverPage(genre ? [server('only-sf', { genre })] : [server('a'), server('b', { genre: 'sf' })]))
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  expect(list.mock.calls.map(([query]) => query)).toEqual([{}])
  fireEvent.click(screen.getByRole('button', { name: '🛰️ SF' }))
  await screen.findByRole('link', { name: /only-sf 세계/ })
  expect(list).toHaveBeenLastCalledWith({ genre: 'sf' }, expect.any(AbortSignal))
  expect(within(screen.getByRole('heading', { name: '🛰️ SF' }).closest('section')!).getAllByRole('link')).toHaveLength(1)
  expect(canvas.props!.atlas.stats.worlds).toBe(2) // 지도는 장르 칩과 상관없이 전체 목록이다
  expect(screen.queryByRole('heading', { name: '새로 공개된 세계관' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '추천' }))
  await screen.findByRole('heading', { name: '세계관 모아 보기' })
  expect(list.mock.calls.filter(([query]) => query?.genre !== undefined)).toHaveLength(1) // 추천 칩은 장르 쿼리를 보내지 않는다
})

it('장르 목록 조회가 실패하면 모아 보기 안에서만 실패를 알리고 지도·순위는 그대로이며 다시 시도하면 읽는다', async () => {
  const list = vi.spyOn(useCase(), 'list').mockImplementation(async ({ genre } = {}) => {
    if (genre) throw new Error('offline')
    return serverPage([server('a')])
  })
  await renderAt('/worlds')
  fireEvent.click(screen.getByRole('button', { name: '🛰️ SF' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('세계관 목록을 불러오지 못했어요.')
  expect(alert.closest('section')?.querySelector('h2')?.textContent).toBe('🛰️ SF')
  screen.getByText('지도 캔버스')
  screen.getByRole('complementary', { name: '실시간 인기 세계관' })
  list.mockImplementation(async ({ genre } = {}) => serverPage([server('sf-world', { genre })]))
  fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
  await screen.findByRole('link', { name: /sf-world 세계/ })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('전체 수가 불러온 수보다 크면 최근 공개 순 앞쪽만 보인다고 지도 통계와 모아 보기 머리에 알린다', async () => {
  vi.spyOn(useCase(), 'list').mockResolvedValue(serverPage([server('a'), server('b')], 40))
  await renderAt('/worlds')
  await screen.findByText('지도 캔버스')
  screen.getByText('공개 세계관 40개 중 최근 2개 · 설정 카드 6개')
  within(screen.getByRole('heading', { name: '세계관 모아 보기' }).closest('section')!).getByText('최근 공개 2개 · 전체 40개')
})

it('서버 세계관 상세는 데모 안내·한 줄 소개 없이 보이고 계보·작품 선반은 준비 중 안내를 보인다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld())
  await renderAt('/worlds/sw')
  expect(screen.queryByText(/데모/)).toBeNull()
  expect(document.querySelector('.worlds-head')?.textContent).toBe('서버 세계작가 서버 작가 · 읽기 전용')
  expect(screen.getByRole('tab', { name: '설정 그래프' }).getAttribute('aria-selected')).toBe('true')
  within(sectionOf('이 세계관을 쓴 작품')).getByText('작품 연결 기능 준비 중')
  within(sectionOf('연결된 세계관')).getByText('파생·조합 기능 준비 중')
  expect(screen.queryByText('아직 이 세계관으로 쓴 작품이 없어요')).toBeNull()
})

it('서버 세계관의 설정집 개요는 계보 줄 없이 장르·작가·설정 카드만 보이고 카드 링크는 카드 id를 쓴다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld())
  await renderAt('/worlds/sw?tab=book')
  const info = within(screen.getByRole('table', { name: '서버 세계' }))
  expect(info.getAllByRole('rowheader').map((e) => e.textContent)).toEqual(['장르', '작가', '설정 카드'])
  expect(info.getAllByRole('cell').slice(1).map((e) => e.textContent)).toEqual(['SF', '서버 작가', '3개'])
  expect(document.querySelector('.worlds-lineage')).toBeNull()
  expect(within(screen.getByRole('table', { name: '설정 카드 목록' })).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([cardPath('sw', 'c-1'), cardPath('sw', 'c-2'), cardPath('sw', 'c-3')])
})

it('서버 관계는 인물끼리면 인물관계도(라벨이 관계)로, 그 밖은 설정 연관으로 그래프에 넘기고 노드는 카드 id 페이지로 이어진다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld())
  await renderAt('/worlds/sw?tab=people')
  await screen.findByText('그래프 캔버스')
  expect(screen.queryByText('데모 · 공개 범위 확정 전')).toBeNull()
  expect(graph.props!.data.nodes.map((n) => [n.name, n.to])).toEqual([['하린', cardPath('sw', 'c-1')], ['도윤', cardPath('sw', 'c-2')]])
  expect(graph.props!.data.links.map((l) => l.label)).toEqual(['적대'])
  within(screen.getByRole('region', { name: '인물관계도' })).getByText('인물 2명 · 관계 1개')
  fireEvent.click(screen.getByRole('tab', { name: '설정 그래프' }))
  await screen.findByText('설정 카드 3개 · 연결 2개')
  expect(graph.props!.data.links.filter((l) => l.kind === 'link').map((l) => l.label)).toEqual(['적대', '거점'])
})

it('관계를 못 불러온 상태(unavailable)는 인물관계도에서 빈 그래프와 구분해 알리고 설정 그래프는 연결 수를 0으로 쓰지 않는다', async () => {
  vi.spyOn(useCase(), 'get').mockResolvedValue(serverWorld({ relationships: [], relationshipStatus: 'unavailable' }))
  await renderAt('/worlds/sw?tab=people')
  screen.getByText(/관계를 불러오지 못했어요/)
  expect(screen.queryByText(/인물이 2명 이상/)).toBeNull()
  expect(screen.queryByRole('region', { name: '인물관계도' })).toBeNull()
  expect(graph.props).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '설정 그래프' }))
  await screen.findByText('그래프 캔버스')
  screen.getByText('설정 카드 3개 · 연결 정보를 불러오지 못했어요')
  expect(graph.props!.summary).toContain('연결 정보를 불러오지 못함')
})

it('비공개·없는 세계관(찾을 수 없음)과 조회 실패를 다르게 알리고 실패는 다시 시도로 읽는다', async () => {
  const get = vi.spyOn(useCase(), 'get').mockResolvedValue(undefined)
  await renderAt('/worlds/hidden')
  screen.getByRole('heading', { level: 1, name: '찾을 수 없는 세계관' })
  expect(screen.queryByRole('alert')).toBeNull()
  cleanup()
  get.mockRejectedValue(new Error('offline'))
  mount('/worlds/hidden')
  expect((await screen.findByRole('alert')).textContent).toContain('세계관을 불러오지 못했어요.')
  expect(screen.queryByRole('heading', { level: 1, name: '찾을 수 없는 세계관' })).toBeNull()
  get.mockResolvedValue(serverWorld({ id: 'hidden' }))
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByRole('heading', { level: 1, name: '서버 세계' })
})

it('다른 세계관으로 옮기면 이전 요청을 취소하고 늦게 온 이전 응답은 화면에 쓰지 않는다', async () => {
  const pending = new Map<string, { signal?: AbortSignal; done: (world: PublicWorld) => void }>()
  vi.spyOn(useCase(), 'get').mockImplementation((id, signal) => new Promise((done) => { pending.set(id, { signal, done }) }))
  const ToB = () => {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate('/worlds/b')}>b로 이동</button>
  }
  mount('/worlds/a', <ToB />)
  await waitFor(() => expect(pending.has('a')).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'b로 이동' }))
  await waitFor(() => expect(pending.has('b')).toBe(true))
  expect(pending.get('a')?.signal?.aborted).toBe(true)
  await act(async () => pending.get('b')?.done(serverWorld({ id: 'b', name: '둘째 세계' })))
  await screen.findByRole('heading', { level: 1, name: '둘째 세계' })
  await act(async () => pending.get('a')?.done(serverWorld({ id: 'a', name: '첫째 세계' })))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('둘째 세계')
})
