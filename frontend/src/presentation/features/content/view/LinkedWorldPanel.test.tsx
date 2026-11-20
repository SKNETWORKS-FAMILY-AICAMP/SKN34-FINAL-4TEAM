// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { InheritedWorld, Work } from '../../../../domain/entities/content'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { LinkedWorldPanel } from './LinkedWorldPanel'

afterEach(cleanup)

const world = (id: string, name: string, linkedWorkId: string | null = null): StudioWorld => ({ id, name, description: '', version: 1, settings: [], analysis: null, linkedWorkId })
const MINE = [world('free', '빈 세계'), world('other', '다른 소설의 세계', 'w2'), world('mine', '이 소설의 세계', 'w1')]
/** 내 세계관 목록 대역과 연결 요청 기록. 목록은 호출마다 list()가 정한 값을 준다. 목록 조회(useAsyncData)가 store를 읽어 Provider로 감싼다. */
function show(worldStudioId: string | null | undefined, list: () => Promise<StudioWorld[]> = async () => MINE, busy = false) {
  const onLink = vi.fn(async () => true)
  const worlds = { list: vi.fn(list) }
  const view = render(<Provider store={createAppStore()}><MemoryRouter><LinkedWorldPanel work={{ id: 'w1', worldStudioId, source: null }} busy={busy} onLink={onLink} onDetach={vi.fn(async () => null)} worlds={worlds} /></MemoryRouter></Provider>)
  return { onLink, worlds, view, card: () => within(screen.getByRole('region', { name: '세계관 연결' })) }
}

it('연결된 세계관은 이름을 그 세계관 관리 화면 링크로 보이고 연결 해제를 요청한다', async () => {
  const { card, onLink } = show('mine')
  const link = await card().findByRole('link', { name: '이 소설의 세계' })
  expect(link.getAttribute('href')).toBe('/worldstudio/mine')
  expect(link.closest('p')?.textContent).toBe('연결된 세계관: 이 소설의 세계')
  expect(card().queryByRole('combobox')).toBeNull()
  fireEvent.click(card().getByRole('button', { name: '연결 해제' }))
  expect(onLink).toHaveBeenCalledWith(null)
})

it('미연결이면 기본값이 선택 안 함이라 고르기 전에는 연결할 수 없고, 고른 세계관으로만 연결을 요청한다', async () => {
  const { card, onLink } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const select = await card().findByRole('combobox', { name: '연결할 세계관' })
  // 다른 소설에 연결된 세계관은 빠지고, 목록을 읽은 뒤 이 소설에서 연결을 푼 세계관은 다시 고를 수 있다. 맨 위 기본 선택은 어느 세계관도 아닌 '선택 안 함'이다.
  expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['선택 안 함', '빈 세계', '이 소설의 세계', '둘째 빈 세계'])
  expect(within(select).getByRole('option', { name: '선택 안 함', selected: true })).toBeTruthy()
  // 고르기 전에는 버튼이 잠기고 이유를 버튼에 이어 알린다. 잠긴 버튼을 눌러도, 양식이 그대로 제출돼도 연결 요청은 가지 않는다.
  const connect = card().getByRole('button', { name: '세계관 연결' }) as HTMLButtonElement
  expect(connect.disabled).toBe(true)
  expect(document.getElementById(connect.getAttribute('aria-describedby') ?? '')?.textContent).toBe('연결할 세계관을 먼저 골라 주세요.')
  fireEvent.click(connect)
  fireEvent.submit(connect.closest('form')!)
  expect(onLink).not.toHaveBeenCalled()
  // 고르면 그 세계관으로 연결을 요청한다.
  fireEvent.change(select, { target: { value: 'free' } })
  expect(connect.disabled).toBe(false)
  expect(card().queryByText('연결할 세계관을 먼저 골라 주세요.')).toBeNull()
  expect(connect.hasAttribute('aria-describedby')).toBe(false)
  fireEvent.click(connect)
  expect(onLink).toHaveBeenLastCalledWith('free')
  fireEvent.change(select, { target: { value: 'free-2' } })
  fireEvent.click(connect)
  expect(onLink).toHaveBeenLastCalledWith('free-2')
  expect(card().queryByRole('button', { name: '연결 해제' })).toBeNull()
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
  await card().findByRole('combobox', { name: '연결할 세계관' })
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
  const worlds = { list: vi.fn(async () => MINE) }
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
  expect((await within(screen.getByRole('region', { name: '세계관 연결' })).findByRole('combobox', { name: '연결할 세계관' }))).toBeTruthy()
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
