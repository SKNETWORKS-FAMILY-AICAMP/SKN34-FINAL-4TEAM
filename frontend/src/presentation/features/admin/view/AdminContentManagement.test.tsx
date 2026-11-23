// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../../../../test/testLocks'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { CARD_CATEGORY_FORBIDDEN } from '../../../../domain/entities/cardCategory'
import { OperationsRejected } from '../../../../domain/entities/operations'
import { EPISODE_INHERITED_MESSAGE, type OperationsEpisode, type OperationsWork } from '../../../../domain/entities/operationsWork'
import { WORLDS_FORBIDDEN, type OperationsWorld } from '../../../../domain/entities/operationsWorld'
import type { Report } from '../../../../domain/entities/report'
import { kstDateTime } from '../../../shared/format'
import { AdminPage } from './AdminPage'

// 운영자 콘텐츠 관리(2026-11-23): 작품 상세 드로어(회차 제한·연결 세계관)·세계관 탭·카드 카테고리 탭·신고 대상 종류를 화면에서 따라간다.
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = 'STORYFORK' })

// 파이프라인 캔버스(react-force-graph, d3·canvas)는 jsdom에서 그리지 않는다.
vi.mock('react-force-graph-2d', () => ({ default: () => null }))

const renderAdmin = (tab: string) => render(
  <Provider store={createAppStore({ role: 'admin' })}>
    <MemoryRouter initialEntries={[`/admin?tab=${tab}`]}><AdminPage /></MemoryRouter>
  </Provider>,
)
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent)
const bodyRows = (region: HTMLElement) => within(region).getAllByRole('row').slice(1)
/** 표 행의 ⋮ 버튼('「이름」 조치')을 눌러 메뉴를 열고 그 메뉴 안을 돌려준다(메뉴는 한 번에 하나만 열려 있다). */
const openRowMenu = (row: HTMLElement) => {
  fireEvent.pointerDown(document.body)
  fireEvent.click(within(row).getByRole('button', { name: /조치$/ }))
  return within(screen.getByRole('menu'))
}
const work = (patch: Partial<OperationsWork> = {}): OperationsWork => ({
  workId: 'w-open', ownerId: 'owner-1', title: '달빛 도서관', authorName: '연화', originKind: 'original', creationType: 'original',
  rightsConfirmed: true, visibility: 'public', restricted: false, ...patch,
})
const episode = (patch: Partial<OperationsEpisode> = {}): OperationsEpisode => ({ number: 1, title: '1화', publicationStatus: 'published', restricted: false, inherited: false, ...patch })
const world = (patch: Partial<OperationsWorld> = {}): OperationsWorld => ({
  worldId: 'wd1', ownerId: 'owner-1', ownerName: '연화', name: '달빛 세계', visibility: 'public', published: true, restricted: false,
  genre: null, createdAt: '2026-11-10T01:00:00Z', linkedWorkId: 'w-open', ...patch,
})

/** 작품 상세 드로어 테스트용: 작품 목록·회차·세계관 UseCase를 대역으로 두고 작품 탭을 연다. */
function openWorks(options: { works?: OperationsWork[]; episodes?: () => Promise<OperationsEpisode[]>; worlds?: () => Promise<OperationsWorld[] | null> } = {}) {
  const works = appContainer.resolve('operationsWorkUseCase')
  vi.spyOn(works, 'list').mockResolvedValue(options.works ?? [work(), work({ workId: 'w-fork', title: '달빛 도서관 외전', authorName: '하늘', originKind: 'fork' })])
  const episodes = vi.spyOn(works, 'episodes').mockImplementation(options.episodes ?? (async () => [episode()]))
  const worlds = vi.spyOn(appContainer.resolve('operationsWorldUseCase'), 'list').mockImplementation(options.worlds ?? (async () => []))
  renderAdmin('works')
  return { works, episodes, worlds, row: async () => (await screen.findByText('달빛 도서관', { selector: 'b' })).closest('tr') as HTMLElement }
}
const drawer = () => screen.findByRole('complementary', { name: '「달빛 도서관」 작품 상세' })

it('작품 행을 누르면 상세 드로어가 열려 회차의 발행·제한·상속 표시와 연결 세계관을 보이고, 제목으로 초점이 간다', async () => {
  const { episodes, row } = openWorks({
    episodes: async () => [episode({ number: 1, title: '프롤로그' }), episode({ number: 2, title: '2화', restricted: true }), episode({ number: 3, title: '3화', publicationStatus: 'draft' }), episode({ number: 4, title: '원작 4화', inherited: true, publicationStatus: 'suspended' })],
    worlds: async () => [world({ worldId: 'wd0', name: '다른 세계', linkedWorkId: 'w-other' }), world()],
  })
  fireEvent.click(await row())
  const panel = await drawer()
  expect(episodes).toHaveBeenCalledWith('w-open')
  expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2, name: '달빛 도서관' }))
  expect(within(panel).getByText('연화 · 원작 · 원작 · 권리 확인됨')).toBeTruthy()
  // 연결 세계관은 세계관 목록의 linkedWorkId로 찾는다(다른 작품에 연결된 세계관은 보이지 않는다).
  await within(panel).findByText('달빛 세계')
  expect(within(panel).queryByText('다른 세계')).toBeNull()
  const table = await within(panel).findByRole('region', { name: '회차 표' })
  expect(bodyRows(table).map(cells)).toEqual([
    ['1화', '프롤로그', '발행', '정상', '—', '운영 제한'],
    ['2화', '2화', '발행', '제한', '—', '제한 해제'],
    ['3화', '3화', '작성 중', '정상', '—', '운영 제한'],
    ['4화', '원작 4화', '공개 중단', '정상', '원작에서 상속', '운영 제한'],
  ])
  expect(within(panel).getByRole('heading', { level: 3, name: '회차 4개' })).toBeTruthy()
  // 상속 회차는 직접 제한할 수 없어 버튼이 잠긴다(원작 회차를 제한해야 한다).
  expect((within(panel).getByRole('button', { name: '4화 운영 제한' }) as HTMLButtonElement).disabled).toBe(true)
  expect((within(panel).getByRole('button', { name: '3화 운영 제한' }) as HTMLButtonElement).disabled).toBe(false)
})

it("⋮ 메뉴의 '상세'로도 열리고, ⋮를 여는 누름은 행 클릭으로 올라가지 않으며, Esc로 닫으면 초점이 그 줄의 ⋮로 돌아온다", async () => {
  const { row } = openWorks()
  const target = await row()
  const menu = openRowMenu(target)
  expect(screen.queryByRole('complementary', { name: /작품 상세/ })).toBeNull()
  fireEvent.click(menu.getByRole('menuitem', { name: '상세' }))
  await drawer()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('complementary', { name: /작품 상세/ })).toBeNull()
  expect(document.activeElement).toBe(within(target).getByRole('button', { name: '「달빛 도서관」 조치' }))
  // 닫기 버튼도 같다.
  fireEvent.click(target)
  fireEvent.click(within(await drawer()).getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('complementary', { name: /작품 상세/ })).toBeNull()
  expect(document.activeElement).toBe(within(target).getByRole('button', { name: '「달빛 도서관」 조치' }))
})

it('회차 제한은 확인을 거쳐 보내고 회차를 다시 읽으며, 해제는 확인 없이 보내고, 실패는 그 회차 이름과 함께 알린다', async () => {
  let rows = [episode({ number: 1 }), episode({ number: 2 })]
  const { works, row } = openWorks({ episodes: async () => rows.map((r) => ({ ...r })) })
  const restrict = vi.spyOn(works, 'setEpisodeRestriction').mockImplementation(async (_id, number, restricted) => { rows = rows.map((r) => (r.number === number ? { ...r, restricted } : r)) })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(await row())
  const panel = await drawer()
  const button = (name: string) => within(panel).findByRole('button', { name })

  fireEvent.click(await button('2화 운영 제한'))
  expect(confirm).toHaveBeenCalledWith('2화를 제한할까요? 독자 열람·조회수 기록·댓글이 막히고 이 회차를 상속한 Fork의 회차도 숨겨져요. 작가 집필은 그대로예요.')
  expect(restrict).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(await button('2화 운영 제한'))
  await within(panel).findByRole('button', { name: '2화 제한 해제' })
  expect(restrict).toHaveBeenCalledWith('w-open', 2, true)
  // 완료 안내는 드로어 안에 한 번만 보인다(화면 위 완료 줄과 겹치지 않는다).
  expect(screen.getAllByText('2화를 운영 제한했어요.')).toHaveLength(1)
  expect(within(panel).getByText('2화를 운영 제한했어요.').getAttribute('role')).toBe('status')

  confirm.mockClear()
  fireEvent.click(await button('2화 제한 해제'))
  await within(panel).findByRole('button', { name: '2화 운영 제한' })
  expect(confirm).not.toHaveBeenCalled()
  expect(restrict).toHaveBeenLastCalledWith('w-open', 2, false)

  // 상속 회차를 서버가 거절하면(409) 한국어 안내를 그 회차 이름과 함께 알리고 목록은 그대로다.
  restrict.mockRejectedValue(new OperationsRejected(EPISODE_INHERITED_MESSAGE))
  fireEvent.click(await button('1화 운영 제한'))
  expect((await within(panel).findByRole('alert')).textContent).toBe(`1화 · ${EPISODE_INHERITED_MESSAGE}`)
  expect(within(panel).getByRole('button', { name: '1화 운영 제한' })).toBeTruthy()
})

it('회차 목록·연결 세계관을 읽지 못하면 실패를 빈 목록으로 숨기지 않고 각각 다시 불러오기를 보인다', async () => {
  let failEpisodes = true
  let failWorlds = true
  const { episodes, worlds, row } = openWorks({
    episodes: async () => { if (failEpisodes) throw new Error('회차 실패'); return [episode()] },
    worlds: async () => { if (failWorlds) throw new Error('세계관 실패'); return [world()] },
  })
  fireEvent.click(await row())
  const panel = await drawer()
  await within(panel).findByText(/회차 목록을 불러오지 못했어요/)
  await within(panel).findByText('연결 세계관을 불러오지 못했어요.')
  expect(within(panel).queryByText('회차가 없어요.')).toBeNull()
  expect(within(panel).queryByText('연결된 세계관이 없어요.')).toBeNull()
  failEpisodes = false
  failWorlds = false
  const retries = within(panel).getAllByRole('button', { name: '다시 불러오기' })
  expect(retries).toHaveLength(2)
  for (const retry of retries) fireEvent.click(retry)
  await within(panel).findByText('달빛 세계')
  await within(panel).findByRole('region', { name: '회차 표' })
  expect(episodes.mock.calls.length).toBeGreaterThan(1)
  expect(worlds.mock.calls.length).toBeGreaterThan(1)
})

it('연결된 세계관이 없으면 그렇게 알리고, 세계관 조회 권한이 없으면(403) 권한 안내만 보인다', async () => {
  const first = openWorks()
  fireEvent.click(await first.row())
  await within(await drawer()).findByText('연결된 세계관이 없어요.')
  cleanup()
  vi.restoreAllMocks()
  const second = openWorks({ worlds: async () => null })
  fireEvent.click(await second.row())
  expect((await within(await drawer()).findByText(WORLDS_FORBIDDEN)).getAttribute('role')).toBe('alert')
})

// ---- 세계관 탭(결정 B) ----
const worldRows = () => [
  world(),
  world({ worldId: 'wd2', name: '비공개 세계', visibility: 'private', published: false, linkedWorkId: null }),
  world({ worldId: 'wd3', name: '저장 전 세계', published: false, linkedWorkId: null, ownerName: '하늘' }),
  world({ worldId: 'wd4', name: '제한된 세계', restricted: true, ownerName: null, linkedWorkId: 'w-unknown' }),
]
function openWorlds(initial = worldRows()) {
  let rows = initial
  const worlds = appContainer.resolve('operationsWorldUseCase')
  const list = vi.spyOn(worlds, 'list').mockImplementation(async () => rows.map((r) => ({ ...r })))
  const setRestriction = vi.spyOn(worlds, 'setRestriction').mockImplementation(async (id, restricted) => { rows = rows.map((r) => (r.worldId === id ? { ...r, restricted } : r)) })
  vi.spyOn(appContainer.resolve('operationsWorkUseCase'), 'list').mockResolvedValue([work()])
  renderAdmin('worlds')
  return { list, setRestriction, table: () => screen.findByRole('region', { name: '세계관 관리 표' }) }
}

it('세계관 탭은 전체 세계관을 공개 상태·연결 작품 제목과 함께 보이고 데모 칩이 없다', async () => {
  const { table } = openWorlds()
  const region = await table()
  const created = kstDateTime('2026-11-10T01:00:00Z')
  await waitFor(() => expect(bodyRows(region).map(cells)[0][3]).toBe('달빛 도서관'))
  expect(bodyRows(region).map(cells)).toEqual([
    ['달빛 세계', '연화', '공개', '달빛 도서관', created, ''],
    ['비공개 세계', '연화', '비공개', '—', created, ''],
    ['저장 전 세계', '하늘', '공개 대기 · 저장 버전 없음', '—', created, ''],
    // 연결 작품의 제목을 작품 목록에서 못 찾으면 제목 없이 '연결됨'이다.
    ['제한된 세계', '—', '운영 제한', '연결됨', created, ''],
  ])
  expect(screen.getByRole('heading', { level: 1, name: '세계관 관리' })).toBeTruthy()
  expect(document.querySelector('.admin-head .chip')).toBeNull()
  expect(within(bodyRows(region)[0]).getByText('공개', { selector: '.chip' }).className).toContain('ok')
  expect(within(bodyRows(region)[3]).getByText('운영 제한', { selector: '.chip' }).className).toContain('wait')
})

it('세계관 검색과 상태 필터는 받은 전체 목록에서 좁힌다', async () => {
  const { table } = openWorlds()
  await table()
  const names = () => screen.getAllByRole('cell').filter((_, i) => i % 6 === 0).map((c) => c.textContent)
  fireEvent.change(screen.getByLabelText('세계관 검색'), { target: { value: '하늘' } })
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
  await waitFor(() => expect(names()).toEqual(['저장 전 세계']))
  fireEvent.change(screen.getByLabelText('세계관 검색'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
  fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'listed' } })
  await waitFor(() => expect(names()).toEqual(['달빛 세계']))
  fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'restricted' } })
  await waitFor(() => expect(names()).toEqual(['제한된 세계']))
  fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'unlisted' } })
  await waitFor(() => expect(names()).toEqual(['비공개 세계', '저장 전 세계']))
  fireEvent.change(screen.getByLabelText('세계관 검색'), { target: { value: '없는 이름' } })
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
  await screen.findByText('조건에 맞는 세계관이 없어요.')
})

it('세계관 제한은 확인을 거쳐 보내고 목록을 다시 읽으며, 해제는 확인 없이 보내고, 실패는 이름과 함께 알린다', async () => {
  const { list, setRestriction, table } = openWorlds()
  const region = await table()
  const open = bodyRows(region)[0]
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '운영 제한' }))
  expect(confirm).toHaveBeenCalledWith('「달빛 세계」 세계관을 제한할까요? 공개 세계관 목록·상세·카드 검색·이미지·가져오기에서 보이지 않아요. 연결된 소설의 설정 위키와 Fork 이어받기는 그대로예요.')
  expect(setRestriction).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '운영 제한' }))
  await within(open).findByText('운영 제한', { selector: '.chip' })
  expect(setRestriction).toHaveBeenCalledWith('wd1', true)
  expect(list.mock.calls.length).toBeGreaterThan(1)
  expect(screen.getAllByText('「달빛 세계」 세계관을 운영 제한했어요.')).toHaveLength(1)

  confirm.mockClear()
  fireEvent.click(openRowMenu(open).getByRole('menuitem', { name: '제한 해제' }))
  await within(open).findByText('공개', { selector: '.chip' })
  expect(confirm).not.toHaveBeenCalled()
  expect(setRestriction).toHaveBeenLastCalledWith('wd1', false)

  setRestriction.mockRejectedValue(new OperationsRejected('이미 지운 세계관이에요.'))
  fireEvent.click(openRowMenu(bodyRows(region)[1]).getByRole('menuitem', { name: '운영 제한' }))
  expect((await screen.findByRole('alert')).textContent).toBe('「비공개 세계」 · 이미 지운 세계관이에요.')
})

it('세계관 조회 권한이 없으면(403) 표 없이 권한 안내만 보이고 읽지 못하면 다시 불러오기를 보인다', async () => {
  const worlds = appContainer.resolve('operationsWorldUseCase')
  vi.spyOn(appContainer.resolve('operationsWorkUseCase'), 'list').mockResolvedValue([])
  vi.spyOn(worlds, 'list').mockResolvedValue(null)
  renderAdmin('worlds')
  expect((await screen.findByRole('alert')).textContent).toBe(WORLDS_FORBIDDEN)
  expect(screen.queryByRole('region', { name: '세계관 관리 표' })).toBeNull()
  cleanup()
  vi.spyOn(worlds, 'list').mockRejectedValue(new Error('세계관 실패'))
  renderAdmin('worlds')
  await screen.findByText(/세계관 목록을 불러오지 못했어요/)
  expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeTruthy()
})

// ---- 카드 카테고리 탭(결정 E, 메모리 대역 = 서버와 같은 규칙) ----
const categoryNames = (region: HTMLElement) => bodyRows(region).map((row) => cells(row).slice(1, 5))

it('카드 카테고리 탭은 기본 8종을 순서·아이콘·이름·상태·카드 수로 보이고 데모 칩이 없다', async () => {
  renderAdmin('cardCategories')
  const region = await screen.findByRole('region', { name: '카드 카테고리 관리 표' })
  expect(bodyRows(region).map(cells).map((row) => row.slice(0, 5))).toEqual([
    ['1', '—', '인물', '활성', '0'], ['2', '—', '장소', '활성', '0'], ['3', '—', '조직', '활성', '0'], ['4', '—', '능력', '활성', '0'],
    ['5', '—', '사물', '활성', '0'], ['6', '—', '규칙', '활성', '0'], ['7', '—', '사건', '활성', '0'], ['8', '—', '기타', '활성', '0'],
  ])
  expect(screen.getByRole('heading', { level: 1, name: '카드 카테고리 관리' })).toBeTruthy()
  expect(document.querySelector('.admin-head .chip')).toBeNull()
  expect(screen.getByText(/AI는 기본 8종만 알아서/)).toBeTruthy()
})

it('카드 카테고리를 추가하면 표 맨 끝에 보이고, 같은 이름은 서버 규칙대로 거절해 이유를 알린다', async () => {
  renderAdmin('cardCategories')
  const region = await screen.findByRole('region', { name: '카드 카테고리 관리 표' })
  const form = screen.getByRole('form', { name: '카드 카테고리 추가' })
  fireEvent.change(within(form).getByLabelText('새 카테고리 이름'), { target: { value: '종족' } })
  fireEvent.change(within(form).getByLabelText(/아이콘/), { target: { value: '🐉' } })
  fireEvent.click(within(form).getByRole('button', { name: '카테고리 추가' }))
  await screen.findByText('「종족」 카테고리를 추가했어요.')
  await waitFor(() => expect(categoryNames(region).at(-1)).toEqual(['🐉', '종족', '활성', '0']))
  expect((within(form).getByLabelText('새 카테고리 이름') as HTMLInputElement).value).toBe('')

  fireEvent.change(within(form).getByLabelText('새 카테고리 이름'), { target: { value: '인물' } })
  fireEvent.click(within(form).getByRole('button', { name: '카테고리 추가' }))
  expect((await screen.findByRole('alert')).textContent).toBe('카테고리 추가 · 이미 같은 이름의 카드 카테고리가 있어요.')
  expect((within(form).getByLabelText('새 카테고리 이름') as HTMLInputElement).value).toBe('인물')
})

it('이름·아이콘 수정은 행 아래 폼으로 하고, 숨기기는 확인 뒤 상태 칩과 메뉴 항목이 바뀌며, 위·아래 이동은 순서를 바꾼다', async () => {
  renderAdmin('cardCategories')
  const region = await screen.findByRole('region', { name: '카드 카테고리 관리 표' })
  const row = (name: string) => bodyRows(region).find((r) => within(r).queryByText(name, { selector: 'b' })) as HTMLElement

  fireEvent.click(openRowMenu(row('장소')).getByRole('menuitem', { name: '이름·아이콘 수정' }))
  const edit = screen.getByRole('form', { name: '「장소」 이름·아이콘 수정' })
  expect(document.activeElement).toBe(within(edit).getByLabelText('카테고리 이름'))
  fireEvent.change(within(edit).getByLabelText('카테고리 이름'), { target: { value: '지역' } })
  fireEvent.change(within(edit).getByLabelText(/아이콘/), { target: { value: '🏰' } })
  fireEvent.click(within(edit).getByRole('button', { name: '저장' }))
  await screen.findByText('「지역」 카테고리를 수정했어요.')
  await waitFor(() => expect(cells(row('지역')).slice(1, 3)).toEqual(['🏰', '지역']))
  expect(screen.queryByRole('form', { name: /이름·아이콘 수정/ })).toBeNull()

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(openRowMenu(row('기타')).getByRole('menuitem', { name: '숨기기' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(cells(row('기타'))[3]).toBe('활성')
  confirm.mockReturnValue(true)
  fireEvent.click(openRowMenu(row('기타')).getByRole('menuitem', { name: '숨기기' }))
  await waitFor(() => expect(cells(row('기타'))[3]).toBe('숨김'))
  fireEvent.click(openRowMenu(row('기타')).getByRole('menuitem', { name: '다시 보이기' }))
  await waitFor(() => expect(cells(row('기타'))[3]).toBe('활성'))

  const order = () => bodyRows(region).map((r) => cells(r)[2])
  expect(order().slice(0, 2)).toEqual(['인물', '지역'])
  expect((openRowMenu(row('인물')).getByRole('menuitem', { name: '위로 옮기기' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('menuitem', { name: '아래로 옮기기' }))
  await waitFor(() => expect(order().slice(0, 2)).toEqual(['지역', '인물']))
  fireEvent.click(openRowMenu(row('인물')).getByRole('menuitem', { name: '위로 옮기기' }))
  await waitFor(() => expect(order().slice(0, 2)).toEqual(['인물', '지역']))
})

it('카드 카테고리 조회 권한이 없으면(403) 폼·표 없이 권한 안내만 보인다', async () => {
  vi.spyOn(appContainer.resolve('operationsCardCategoryUseCase'), 'list').mockResolvedValue(null)
  renderAdmin('cardCategories')
  expect((await screen.findByRole('alert')).textContent).toBe(CARD_CATEGORY_FORBIDDEN)
  expect(screen.queryByRole('form', { name: '카드 카테고리 추가' })).toBeNull()
  expect(screen.queryByRole('region', { name: '카드 카테고리 관리 표' })).toBeNull()
})

// ---- 신고 대상 종류(결정 D) ----
const report = (patch: Partial<Report>): Report => ({
  id: 'rep-1', kind: 'RIGHTS', targetType: 'work', workId: 'w-open', workTitle: '달빛 도서관', workOwnerId: 'o1', episodeNumber: null, worldId: null, worldName: null,
  reporterId: 'r1', reason: '권리 침해', evidence: '근거', status: 'RECEIVED', contentRestricted: false, createdAt: '2026-11-09T01:00:00Z', updatedAt: '2026-11-09T01:00:00Z', ...patch,
})

it('신고 표는 대상과 대상 종류(작품·회차·세계관)를 보이고, 상세·제한 버튼도 그 종류의 이름을 쓴다', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  try {
    const rows = [
      report({ id: 'rep-1' }),
      report({ id: 'rep-2', targetType: 'episode', episodeNumber: 3 }),
      report({ id: 'rep-3', targetType: 'world', workId: null, workTitle: null, workOwnerId: null, worldId: 'wd1', worldName: '달빛 세계', contentRestricted: true }),
    ]
    const reports = appContainer.resolve('reportUseCase')
    vi.spyOn(reports, 'listAll').mockResolvedValue(rows)
    const restrict = vi.spyOn(reports, 'setContentRestriction').mockResolvedValue(undefined)
    vi.spyOn(reports, 'get').mockImplementation(async (id) => ({ ...(rows.find((r) => r.id === id) as Report), history: [] }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAdmin('rights')
    const table = await screen.findByRole('region', { name: '운영 신고 표' })
    expect(bodyRows(table).map(cells).map((row) => row.slice(0, 6))).toEqual([
      ['달빛 도서관', '작품', '권리 침해', '권리 침해', '접수', '공개 유지'],
      ['달빛 도서관 3화', '회차', '권리 침해', '권리 침해', '접수', '공개 유지'],
      ['달빛 세계', '세계관', '권리 침해', '권리 침해', '접수', '제한 중'],
    ])

    fireEvent.click(bodyRows(table)[1])
    await screen.findByRole('heading', { name: '신고 상세 · 달빛 도서관 3화' })
    expect(screen.getByText('대상 종류', { selector: 'dt' }).nextElementSibling?.textContent).toBe('회차')
    fireEvent.click(screen.getByRole('button', { name: '회차 제한' }))
    expect(confirm).toHaveBeenCalledWith('「달빛 도서관 3화」을(를) 제한할까요? 해제 전까지 독자에게 보이지 않아요.')
    await waitFor(() => expect(restrict).toHaveBeenCalledWith('rep-2', true))
    await screen.findByText('신고 대상을 제한했어요.')

    fireEvent.click(bodyRows(table)[2])
    await screen.findByRole('heading', { name: '신고 상세 · 달빛 세계' })
    expect(screen.getByText('접수 · 세계관 제한 중')).toBeTruthy()
    expect(screen.getByRole('button', { name: '세계관 제한 해제' })).toBeTruthy()
  } finally { Reflect.deleteProperty(Element.prototype, 'scrollIntoView') }
})
