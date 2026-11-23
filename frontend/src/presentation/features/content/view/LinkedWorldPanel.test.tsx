// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { InheritedWorld, Work } from '../../../../domain/entities/content'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { LinkedWorldPanel } from './LinkedWorldPanel'

/** 올린 표지를 소유자 인증으로 읽는 공용 훅의 대역. 기본값은 읽는 중이다(서재 MyWorlds 테스트와 같은 방식). */
const cover = vi.hoisted(() => vi.fn<(useCase: unknown, worldId: string | undefined, enabled: boolean, revision: number) => { url: string; error: string }>(() => ({ url: '', error: '' })))
vi.mock('../../../shared/useWorldCoverImage', () => ({ useWorldCoverImage: cover }))

afterEach(() => { cleanup(); cover.mockReset() })

const world = (id: string, name: string, linkedWorkId: string | null = null, extra: Partial<StudioWorld> = {}): StudioWorld => ({ id, name, description: '', version: 1, settings: [], analysis: null, linkedWorkId, ...extra })
const MINE = [world('free', '빈 세계'), world('other', '다른 소설의 세계', 'w2'), world('mine', '이 소설의 세계', 'w1')]
const stubWorlds = (list: () => Promise<StudioWorld[]>, supportsCover = false) => ({ list: vi.fn(list), cover: vi.fn(), supportsCover })
/** 내 세계관 목록 대역과 연결 요청 기록. 목록은 호출마다 list()가 정한 값을 준다. 목록 조회(useAsyncData)가 store를 읽어 Provider로 감싼다. */
function show(worldStudioId: string | null | undefined, list: () => Promise<StudioWorld[]> = async () => MINE, busy = false, supportsCover = false) {
  const onLink = vi.fn(async () => true)
  const worlds = stubWorlds(list, supportsCover)
  const store = createAppStore()
  const tree = (id: string | null | undefined) => <Provider store={store}><MemoryRouter><LinkedWorldPanel work={{ id: 'w1', worldStudioId: id, source: null }} busy={busy} onLink={onLink} onDetach={vi.fn(async () => null)} worlds={worlds} /></MemoryRouter></Provider>
  const view = render(tree(worldStudioId))
  /** 부모가 연결·해제 결과를 작품에 반영한 것처럼 같은 패널을 다른 연결 상태로 다시 그린다(패널 안의 선택·검색어 상태는 그대로 남는다). */
  const relink = (id: string | null) => view.rerender(tree(id))
  return { onLink, worlds, view, relink, card: () => within(screen.getByRole('region', { name: '세계관 연결' })) }
}
/** 목록에 보이는 세계관 이름(카드 라디오의 이름)을 위에서 아래로 */
const listed = (card: ReturnType<typeof show>['card']) => card().queryAllByRole('radio').map((radio) => document.getElementById(radio.getAttribute('aria-labelledby') ?? '')?.textContent)
/** 카드 한 장의 표지 이미지 주소. 이미지가 없으면(표지를 읽는 중) undefined */
const coverOf = (card: ReturnType<typeof show>['card'], name: string) => card().getByRole('radio', { name }).closest('label')?.querySelector('img')?.getAttribute('src')

it('연결된 세계관은 이름을 그 세계관 관리 화면 링크로 보이고 연결 해제를 요청한다', async () => {
  const { card, onLink } = show('mine')
  const link = await card().findByRole('link', { name: '이 소설의 세계' })
  expect(link.getAttribute('href')).toBe('/worldstudio/mine')
  expect(link.closest('p')?.textContent).toBe('연결된 세계관: 이 소설의 세계')
  expect(card().queryByRole('searchbox')).toBeNull()
  expect(card().queryByRole('radio')).toBeNull()
  // 1:1·독자 위키 공개 범위 설명은 고를 때 필요한 정보라 이미 연결된 뒤에는 읽히지 않는다.
  expect(card().queryByText(/세계관 하나는 소설 하나에만 연결돼요/)).toBeNull()
  fireEvent.click(card().getByRole('button', { name: '연결 해제' }))
  expect(onLink).toHaveBeenCalledWith(null)
})

it('미연결이면 검색창 아래 목록에서 고르기 전에는 연결할 수 없고, 고른 세계관으로만 연결을 요청한다', async () => {
  const { card, onLink } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' }) as HTMLInputElement
  // 드롭다운이 아니라 검색창과 표지 카드 목록이다. 연결 전에는 세계관을 고르는 데 필요한 규칙 설명이 그대로 보인다.
  expect(card().queryByRole('combobox')).toBeNull()
  expect(card().getByText(/세계관 하나는 소설 하나에만 연결돼요/)).toBeTruthy()
  // 검색어가 비면 연결할 수 있는 세계관 전체다: 다른 소설에 연결된 세계관은 빠지고, 목록을 읽은 뒤 이 소설에서 연결을 푼 세계관은 다시 고를 수 있다. 처음에는 아무것도 고르지 않았다.
  expect(search.value).toBe('')
  expect(card().getByRole('group', { name: '연결할 세계관' })).toBeTruthy()
  expect(listed(card)).toEqual(['빈 세계', '이 소설의 세계', '둘째 빈 세계'])
  expect(card().queryAllByRole('radio', { checked: true })).toEqual([])
  // 고르기 전에는 버튼이 잠기고 이유를 버튼에 이어 알린다. 잠긴 버튼을 눌러도, 양식이 그대로 제출돼도 연결 요청은 가지 않는다.
  const connect = card().getByRole('button', { name: '세계관 연결' }) as HTMLButtonElement
  expect(connect.disabled).toBe(true)
  expect(document.getElementById(connect.getAttribute('aria-describedby') ?? '')?.textContent).toBe('연결할 세계관을 먼저 골라 주세요.')
  fireEvent.click(connect)
  fireEvent.submit(connect.closest('form')!)
  expect(onLink).not.toHaveBeenCalled()
  // 고르면 그 세계관으로 연결을 요청한다.
  fireEvent.click(card().getByRole('radio', { name: '빈 세계' }))
  expect(connect.disabled).toBe(false)
  expect(card().queryByText('연결할 세계관을 먼저 골라 주세요.')).toBeNull()
  expect(connect.hasAttribute('aria-describedby')).toBe(false)
  fireEvent.click(connect)
  expect(onLink).toHaveBeenLastCalledWith('free')
  fireEvent.click(card().getByRole('radio', { name: '둘째 빈 세계' }))
  fireEvent.click(connect)
  expect(onLink).toHaveBeenLastCalledWith('free-2')
  expect(card().queryByRole('button', { name: '연결 해제' })).toBeNull()
})

it('세계관은 검색 화면의 카드처럼 표지·이름·설정 카드 수로 보이고, 검색창은 연결 양식 밖에 있어 Enter가 연결을 제출하지 않는다', async () => {
  const { card } = show(null, async () => [world('free', '빈 세계', null, { cardCount: 12 }), world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' }) as HTMLInputElement
  // 검색창이 연결 양식 안에 있으면 Enter가 양식을 제출해 고른 세계관을 바로 연결한다.
  expect(search.form).toBeNull()
  expect(card().getByRole('button', { name: '세계관 연결' }).closest('form')).toBeTruthy()
  const description = (name: string) => document.getElementById(card().getByRole('radio', { name }).getAttribute('aria-describedby') ?? '')?.textContent
  // 서버 요약의 카드 수(cardCount)를 쓰고, 없으면 설정 수다.
  expect(description('빈 세계')).toBe('설정 카드 12개')
  expect(description('둘째 빈 세계')).toBe('설정 카드 0개')
  expect(coverOf(card, '빈 세계')).toBe('/default-work-cover.svg')
})

it('고른 세계관 카드에만 선택됨이 보이고, 검색으로 빠져 선택이 비워지면 사라진다', async () => {
  const { card } = show(null)
  const search = await card().findByRole('searchbox', { name: '세계관 검색' })
  expect(card().queryByText('선택됨')).toBeNull()
  fireEvent.click(card().getByRole('radio', { name: '빈 세계' }))
  expect(card().getAllByText('선택됨')).toHaveLength(1)
  expect(card().getByText('선택됨').closest('label')).toBe(card().getByRole('radio', { name: '빈 세계' }).closest('label'))
  fireEvent.change(search, { target: { value: '이 소설' } })
  expect(card().queryByText('선택됨')).toBeNull()
})

it('올린 표지가 있는 세계관은 소유자 인증으로 읽은 표지를, 없거나 읽지 못하면 기본 표지를, 읽는 동안은 빈 칸을 보인다', async () => {
  const read: Record<string, { url: string; error: string }> = { w2: { url: 'blob:world-cover', error: '' }, w3: { url: '', error: '표지를 불러오지 못했어요.' } }
  cover.mockImplementation((_useCase, id) => read[id ?? ''] ?? { url: '', error: '' })
  const { card, worlds } = show(null, async () => [world('w1', '세계 1'), world('w2', '세계 2', null, { hasCover: true }), world('w3', '세계 3', null, { hasCover: true }), world('w4', '세계 4', null, { hasCover: true })], false, true)
  await card().findByRole('searchbox', { name: '세계관 검색' })
  // 읽는 동안(w4)은 기본 표지가 아니라 빈 칸이라, 올린 표지가 기본 표지에서 바뀌며 깜빡이지 않는다.
  expect(['세계 1', '세계 2', '세계 3', '세계 4'].map((name) => coverOf(card, name))).toEqual(['/default-work-cover.svg', 'blob:world-cover', '/default-work-cover.svg', undefined])
  expect(cover).toHaveBeenCalledWith(worlds, 'w1', false, 0) // 올린 표지가 없는 세계관은 읽지 않는다
  expect(cover).toHaveBeenCalledWith(worlds, 'w2', true, 0)
})

it('표지 저장소가 없는 데모는 올린 표지가 있다고 해도 읽지 않고 기본 표지를 보인다', async () => {
  const { card, worlds } = show(null, async () => [world('w1', '세계 1', null, { hasCover: true })])
  await card().findByRole('searchbox', { name: '세계관 검색' })
  expect(coverOf(card, '세계 1')).toBe('/default-work-cover.svg')
  expect(cover).toHaveBeenCalledWith(worlds, 'w1', false, 0)
})

it('검색어로 이름을 걸러 목록을 좁히고, 비우면 전체로 돌아오며, 결과가 없으면 알린다', async () => {
  const { card } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' })
  fireEvent.change(search, { target: { value: '빈' } })
  expect(listed(card)).toEqual(['빈 세계', '둘째 빈 세계'])
  fireEvent.change(search, { target: { value: '둘째' } })
  expect(listed(card)).toEqual(['둘째 빈 세계'])
  expect(card().queryByText('검색 결과가 없어요')).toBeNull()
  // 결과가 없어도 검색창은 남는다(검색어를 고쳐 다시 찾을 수 있다).
  fireEvent.change(search, { target: { value: '없는 이름' } })
  expect(listed(card)).toEqual([])
  expect(card().getByRole('status').textContent).toBe('검색 결과가 없어요')
  fireEvent.change(search, { target: { value: '' } })
  expect(listed(card)).toEqual(['빈 세계', '이 소설의 세계', '둘째 빈 세계'])
})

it('고른 세계관이 검색으로 목록에서 빠지면 선택을 비워 연결을 잠그고, 목록에 남아 있으면 선택을 유지한다', async () => {
  const { card, onLink } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const search = await card().findByRole('searchbox', { name: '세계관 검색' })
  const connect = card().getByRole('button', { name: '세계관 연결' }) as HTMLButtonElement
  const checked = (name: string) => (card().getByRole('radio', { name }) as HTMLInputElement).checked
  fireEvent.click(card().getByRole('radio', { name: '빈 세계' }))
  // 검색해도 목록에 남아 있으면 그대로 고른 채다.
  fireEvent.change(search, { target: { value: '빈' } })
  expect(checked('빈 세계')).toBe(true)
  expect(connect.disabled).toBe(false)
  // 목록에서 빠지면 선택을 비운다: 보이지 않는 세계관으로 연결하지 않고, 검색어를 지워도 되살아나지 않는다.
  fireEvent.change(search, { target: { value: '이 소설' } })
  expect(connect.disabled).toBe(true)
  fireEvent.submit(connect.closest('form')!)
  expect(onLink).not.toHaveBeenCalled()
  fireEvent.change(search, { target: { value: '' } })
  expect(card().queryAllByRole('radio', { checked: true })).toEqual([])
})

it('연결을 해제하면 고른 세계관과 검색어를 비워, 다시 나타난 양식이 직전 선택으로 시작하지 않는다', async () => {
  const { card, onLink, relink } = show(null)
  fireEvent.change(await card().findByRole('searchbox', { name: '세계관 검색' }), { target: { value: '이 소설' } })
  fireEvent.click(card().getByRole('radio', { name: '이 소설의 세계' }))
  relink('mine') // 연결이 작품에 반영돼 양식이 사라진다
  fireEvent.click(card().getByRole('button', { name: '연결 해제' }))
  expect(onLink).toHaveBeenLastCalledWith(null)
  relink(null) // 해제가 반영돼 양식이 다시 나타난다
  expect((card().getByRole('searchbox', { name: '세계관 검색' }) as HTMLInputElement).value).toBe('')
  expect(card().queryAllByRole('radio', { checked: true })).toEqual([])
})

it('연결할 수 있는 내 세계관이 없으면 세계관 만들기로 안내한다', async () => {
  const { card } = show(undefined, async () => [world('other', '다른 소설의 세계', 'w2')])
  await card().findByText('연결할 수 있는 내 세계관이 없어요. 다른 소설에 연결되지 않은 세계관만 연결할 수 있어요.')
  expect(card().getByRole('link', { name: '세계관 만들기' }).getAttribute('href')).toBe('/worldstudio')
  expect(card().queryByRole('button', { name: '세계관 연결' })).toBeNull()
})

it('내 세계관을 읽는 동안과 읽지 못했을 때를 빈 목록과 구분해 알리고 다시 불러온다', async () => {
  let fail = true
  const { card, worlds } = show(null, async () => { if (fail) throw new Error('offline'); return MINE })
  expect(card().getByRole('status').textContent).toBe('내 세계관을 불러오고 있어요…')
  expect((await card().findByRole('alert')).textContent).toBe('내 세계관을 불러오지 못했어요.')
  expect(card().queryByText(/연결할 수 있는 내 세계관이 없어요/)).toBeNull()
  fail = false
  fireEvent.click(card().getByRole('button', { name: '내 세계관 다시 불러오기' }))
  await card().findByRole('searchbox', { name: '세계관 검색' })
  expect(card().queryByRole('alert')).toBeNull()
  expect(worlds.list).toHaveBeenCalledTimes(2)
})

it('세계관 이름을 읽지 못해도 연결된 세계관으로 가는 링크와 연결 해제는 남고, 처리 중에는 누를 수 없다', async () => {
  const { card } = show('mine', async () => { throw new Error('offline') }, true)
  await card().findByRole('alert')
  expect(card().getByRole('link', { name: '세계관 열기' }).getAttribute('href')).toBe('/worldstudio/mine')
  expect((card().getByRole('button', { name: '연결 해제' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => {})
})

// ── Fork 세계관 독립(#583): 자기 세계관이 없는 Fork는 이어받는 원작 세계관을 읽기 전용으로 보이고 내 세계관으로 독립시킨다 ──

const FORK = { id: 'fork', worldStudioId: null, source: { workId: 'o', title: '원작', episode: 2, version: 1, direction: '' } }
const inheritedCard = (id: string, title: string, cardType: string) => ({ id, title, cardType, aliases: [] })
const INHERITED: InheritedWorld = {
  upto: 2, relationshipCount: 3,
  cards: [inheritedCard('c1', '카엘', 'character'), inheritedCard('p1', '성문', 'location'), inheritedCard('c2', '린', 'character')],
}
const DETACH = '내 세계관으로 만들어 수정하기'
/**
 * 이어받는 세계관 조회·내 세계관 목록 대역과 독립 요청 기록. 독립이 성공하면 새 세계관 관리 화면(/worldstudio/:id)으로 가는지는 그 주소의 라우트로 확인한다.
 * 독립 요청 중 잠금과 실패 문구는 작품 관리 화면(useEpisodeViewModel)이 busy·detachError로 내려 주므로 여기서는 그 값을 직접 준다.
 */
function showFork({ inherited = async () => INHERITED as InheritedWorld | null, work = FORK as Pick<Work, 'id' | 'worldStudioId' | 'source'>, busy = false, detach = async () => 'new-world' as string | null, detachError = '' } = {}) {
  const onDetach = vi.fn(detach)
  const useCase = { inheritedWorld: vi.fn(inherited) }
  const worlds = stubWorlds(async () => MINE)
  const view = render(
    <Provider store={createAppStore()}>
      <MemoryRouter initialEntries={['/content']}>
        <Routes>
          <Route path='/content' element={<LinkedWorldPanel work={work} busy={busy} onLink={vi.fn(async () => true)} onDetach={onDetach} detachError={detachError} useCase={useCase} worlds={worlds} />} />
          <Route path='/worldstudio/:id' element={<p>세계관 관리 화면</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  return { onDetach, useCase, view, card: () => within(screen.getByRole('region', { name: '이어받는 원작 세계관' })) }
}

it('자기 세계관이 없는 Fork는 이어받는 원작 세계관을 N화 기준의 카드 유형별 수·제목과 관계 수로 읽기 전용으로 보인다', async () => {
  const { card, useCase } = showFork()
  await card().findByText('원작 「원작」 세계관을 2화 기준으로 이어받는 중')
  expect(card().getAllByRole('term').map((term) => term.textContent)).toEqual(['인물 2', '장소 1', '관계'])
  expect(card().getAllByRole('definition').map((definition) => definition.textContent)).toEqual(['카엘, 린', '성문', '3개'])
  expect(card().getByRole('button', { name: DETACH })).toBeTruthy()
  // 상한 회차는 서버가 Fork 기준 회차로 정하므로 upto를 보내지 않는다.
  expect(useCase.inheritedWorld).toHaveBeenCalledWith('fork', undefined, expect.any(AbortSignal))
  // 기존 '세계관 연결' 카드는 그대로 따로 있다.
  expect((await within(screen.getByRole('region', { name: '세계관 연결' })).findByRole('searchbox', { name: '세계관 검색' }))).toBeTruthy()
})

it('Fork가 아니거나 자기 세계관이 연결됐으면 이어받는 세계관을 묻지 않고, 이어받는 것이 없으면(null) 카드를 보이지 않는다', async () => {
  for (const work of [{ ...FORK, source: null }, { ...FORK, worldStudioId: 'mine' }]) {
    const { useCase, view } = showFork({ work })
    await act(async () => {})
    expect(useCase.inheritedWorld).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: '이어받는 원작 세계관' })).toBeNull()
    view.unmount()
  }
  const { useCase } = showFork({ inherited: async () => null })
  await waitFor(() => expect(screen.queryByRole('region', { name: '이어받는 원작 세계관' })).toBeNull())
  expect(useCase.inheritedWorld).toHaveBeenCalledTimes(1)
})

it('이어받은 세계관을 읽지 못하면 빈 상태로 바꾸지 않고 실패로 알리며 독립 버튼 없이 다시 불러온다', async () => {
  let fail = true
  const { card, useCase } = showFork({ inherited: async () => { if (fail) throw new Error('offline'); return INHERITED } })
  expect(card().getByRole('status').textContent).toBe('원작 세계관을 불러오고 있어요…')
  expect((await card().findByRole('alert')).textContent).toBe('원작 세계관을 불러오지 못했어요.')
  expect(card().queryByRole('button', { name: DETACH })).toBeNull()
  fail = false
  fireEvent.click(card().getByRole('button', { name: '원작 세계관 다시 불러오기' }))
  await card().findByText('원작 「원작」 세계관을 2화 기준으로 이어받는 중')
  expect(card().queryByRole('alert')).toBeNull()
  expect(useCase.inheritedWorld).toHaveBeenCalledTimes(2)
})

it('관계 상태를 모르면(null) 관계 0개로 채우지 않고 불러오지 못했다고 알리며, 관계가 정말 없으면 0개로 보인다', async () => {
  const relations = (view: ReturnType<typeof showFork>) => view.card().getAllByRole('definition').at(-1)?.textContent
  const unknown = showFork({ inherited: async () => ({ ...INHERITED, relationshipCount: null }) })
  await unknown.card().findByText('불러오지 못했어요')
  expect(relations(unknown)).toBe('불러오지 못했어요')
  unknown.view.unmount()
  const none = showFork({ inherited: async () => ({ ...INHERITED, relationshipCount: 0 }) })
  await none.card().findByText('0개')
  expect(relations(none)).toBe('0개')
})

it('내 세계관으로 만들어 수정하기를 누르면 독립을 한 번 요청하고 성공하면 새 세계관 관리 화면으로 간다', async () => {
  const { card, onDetach } = showFork()
  fireEvent.click(await card().findByRole('button', { name: DETACH }))
  expect(onDetach).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('세계관 관리 화면')).toBeTruthy()
})

it('독립에 실패하면(null) 이동하지 않고 서버 문구를 이 카드 안에 보이며, 연결 카드에는 보이지 않는다', async () => {
  const { card, onDetach } = showFork({ detach: async () => null, detachError: '이어받는 원작 세계관이 없어요.' })
  fireEvent.click(await card().findByRole('button', { name: DETACH }))
  await waitFor(() => expect(onDetach).toHaveBeenCalledTimes(1))
  expect(card().getByRole('alert').textContent).toBe('이어받는 원작 세계관이 없어요.')
  expect(within(screen.getByRole('region', { name: '세계관 연결' })).queryByRole('alert')).toBeNull()
  expect(screen.queryByText('세계관 관리 화면')).toBeNull()
})

it('이어받은 카드가 없으면 독립할 것이 없어 버튼을 잠그고 이유를 알린다', async () => {
  const { card, onDetach } = showFork({ inherited: async () => ({ ...INHERITED, cards: [], relationshipCount: 0 }) })
  await card().findByText('이어받은 카드가 없어서 독립할 수 없어요.')
  const button = card().getByRole('button', { name: DETACH }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('이어받은 카드가 없어서 독립할 수 없어요.')
  expect(card().queryAllByRole('term')).toEqual([])
  fireEvent.click(button)
  expect(onDetach).not.toHaveBeenCalled()
})

it('다른 요청을 처리하는 중이면 독립 버튼을 누를 수 없다', async () => {
  const { card, onDetach } = showFork({ busy: true })
  const button = await card().findByRole('button', { name: DETACH }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(onDetach).not.toHaveBeenCalled()
})
