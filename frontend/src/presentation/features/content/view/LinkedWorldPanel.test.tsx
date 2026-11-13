// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { LinkedWorldPanel } from './LinkedWorldPanel'

afterEach(cleanup)

const world = (id: string, name: string, linkedWorkId: string | null = null): StudioWorld => ({ id, name, description: '', version: 1, settings: [], analysis: null, linkedWorkId })
const MINE = [world('free', '빈 세계'), world('other', '다른 소설의 세계', 'w2'), world('mine', '이 소설의 세계', 'w1')]
/** 내 세계관 목록 대역과 연결 요청 기록. 목록은 호출마다 list()가 정한 값을 준다. 목록 조회(useAsyncData)가 store를 읽어 Provider로 감싼다. */
function show(worldStudioId: string | null | undefined, list: () => Promise<StudioWorld[]> = async () => MINE, busy = false) {
  const onLink = vi.fn(async () => true)
  const worlds = { list: vi.fn(list) }
  const view = render(<Provider store={createAppStore()}><MemoryRouter><LinkedWorldPanel work={{ id: 'w1', worldStudioId }} busy={busy} onLink={onLink} worlds={worlds} /></MemoryRouter></Provider>)
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

it('미연결이면 다른 소설에 연결되지 않은 내 세계관만 고를 수 있고 고른 세계관으로 연결을 요청한다', async () => {
  const { card, onLink } = show(null, async () => [...MINE, world('free-2', '둘째 빈 세계')])
  const select = await card().findByRole('combobox', { name: '연결할 세계관' })
  // 다른 소설에 연결된 세계관은 빠지고, 목록을 읽은 뒤 이 소설에서 연결을 푼 세계관은 다시 고를 수 있다.
  expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['빈 세계', '이 소설의 세계', '둘째 빈 세계'])
  fireEvent.click(card().getByRole('button', { name: '세계관 연결' }))
  expect(onLink).toHaveBeenLastCalledWith('free')
  fireEvent.change(select, { target: { value: 'free-2' } })
  fireEvent.click(card().getByRole('button', { name: '세계관 연결' }))
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
