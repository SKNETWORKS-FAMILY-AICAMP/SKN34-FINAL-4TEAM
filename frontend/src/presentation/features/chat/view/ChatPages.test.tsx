// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = 'STORYFORK' })

const expectOneMain = () => {
  const mains = document.querySelectorAll('main')
  expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main')
  expect(mains[0].getAttribute('tabindex')).toBe('-1')
  return mains[0]
}
const h1s = () => screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)
const chat = () => appContainer.resolve('chatUseCase')
const user = () => createAppStore({ role: 'user' })
const room = '/chat/guunmong/' + encodeURIComponent('성진')

it('캐릭터챗 목록은 main 하나와 h1 하나를 갖고 탭 제목은 캐릭터챗이다', async () => {
  renderApp('/chat', user())
  const title = await screen.findByRole('heading', { name: '캐릭터챗', level: 1 })
  expect(expectOneMain().contains(title)).toBe(true)
  expect(h1s()).toEqual(['캐릭터챗'])
  await waitFor(() => expect(document.title).toBe('캐릭터챗 · STORYFORK'))
})

it('대화방도 main 하나와 h1 하나를 갖는다', async () => {
  renderApp(room, user())
  await screen.findByText('소승 성진이라 합니다. 무엇이 궁금하십니까?')
  expectOneMain()
  expect(h1s()).toEqual(['캐릭터챗'])
  await waitFor(() => expect(document.title).toBe('캐릭터챗 · STORYFORK'))
})

it('목록을 불러오는 동안에도 상단바와 h1을 그리고 불러오는 중임을 알린다', async () => {
  const list = chat().list.bind(chat())
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  vi.spyOn(chat(), 'list').mockImplementation(async (filter) => { await gate; return list(filter) })
  renderApp('/chat', user())
  const loading = await screen.findByText('캐릭터챗을 불러오고 있어요.')
  expect(loading.getAttribute('role')).toBe('status')
  expectOneMain()
  expect(h1s()).toEqual(['캐릭터챗'])
  screen.getByRole('navigation', { name: '주요 메뉴' })
  await act(async () => { release() })
  await screen.findByRole('navigation', { name: '작품 유형' })
  expect(screen.queryByText('캐릭터챗을 불러오고 있어요.')).toBeNull()
})

it('목록을 불러오지 못하면 빈 화면으로 숨기지 않고 알린 뒤 다시 불러올 수 있다', async () => {
  const list = vi.spyOn(chat(), 'list').mockRejectedValue(new Error('down'))
  renderApp('/chat', user())
  const alert = await screen.findByText('캐릭터챗을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  expect(alert.closest('[role=alert]')).not.toBeNull()
  expectOneMain()
  expect(h1s()).toEqual(['캐릭터챗'])
  list.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByRole('navigation', { name: '작품 유형' })
  expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
})

it('필터를 바꿔도 화면을 비우지 않아 고르던 select가 초점과 함께 남고 고른 값을 바로 보인다', async () => {
  renderApp('/chat', user())
  const select = await screen.findByLabelText<HTMLSelectElement>('작품')
  const picked = Array.from(select.options, (option) => option.value).find((value) => value !== 'all')!
  select.focus()
  fireEvent.change(select, { target: { value: picked } })
  expect(select.isConnected).toBe(true)
  expect(document.activeElement).toBe(select)
  expect(select.value).toBe(picked)
  await act(async () => {})
  expect(screen.getByLabelText('작품')).toBe(select)
  expect(select.value).toBe(picked)
})

it('대화방을 불러오지 못하면 틀을 그린 채 알리고 다시 불러올 수 있다', async () => {
  const page = vi.spyOn(chat(), 'page').mockRejectedValue(new Error('down'))
  renderApp(room, user())
  const alert = await screen.findByText('대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  expect(alert.closest('[role=alert]')).not.toBeNull()
  expectOneMain()
  expect(h1s()).toEqual(['캐릭터챗'])
  screen.getByRole('link', { name: '캐릭터챗 목록' })
  page.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByText('소승 성진이라 합니다. 무엇이 궁금하십니까?')
  expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
})

it('대화 기록은 화자를 글자로 밝히고 키보드로 닿으며 지금 고른 작품과 인물을 알린다', async () => {
  renderApp(room, user())
  const greeting = await screen.findByText('소승 성진이라 합니다. 무엇이 궁금하십니까?')
  const log = screen.getByRole('log', { name: '성진 대화 기록' })
  expect(log.getAttribute('tabindex')).toBe('0')
  expect(greeting.parentElement!.textContent).toBe('성진소승 성진이라 합니다. 무엇이 궁금하십니까?')
  const side = within(screen.getByRole('complementary', { name: '대화 상대' }))
  expect(side.getByRole('link', { name: /^성진/ }).getAttribute('aria-current')).toBe('page')
  expect(side.getByRole('link', { name: '구운몽' }).getAttribute('aria-current')).toBe('true')
  expect(side.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['작품', expect.stringMatching(/^인물/)])

  fireEvent.click(screen.getByRole('button', { name: '용궁에서 왜 술을 마셨어요?' }))
  const mine = await within(log).findByText('용궁에서 왜 술을 마셨어요?')
  expect(mine.parentElement!.textContent).toBe('나용궁에서 왜 술을 마셨어요?')
})

it('빈 질문은 입력칸에 이어진 경고로 알리고, 글을 쓰기 시작하면 경고를 거둔다', async () => {
  renderApp(room, user())
  const input = await screen.findByLabelText<HTMLInputElement>('성진에게 질문')
  // 세션 복원 안내(App의 role=alert)와 토스트가 함께 있으므로 문구와 역할로 이 경고만 고른다.
  const warning = () => screen.queryByText('물어볼 내용을 입력해 주세요', { selector: '[role=alert]' })
  fireEvent.click(screen.getByRole('button', { name: '보내기' }))
  await waitFor(() => expect(warning()).not.toBeNull())
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toBe(warning()!.id)
  expect(warning()!.id).not.toBe('')
  fireEvent.change(input, { target: { value: '안녕하세요' } })
  expect(warning()).toBeNull()
  expect(input.getAttribute('aria-invalid')).toBe('false')
})
