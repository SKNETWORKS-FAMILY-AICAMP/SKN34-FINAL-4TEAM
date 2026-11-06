// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { createMockDb } from '../../../../data/mock/InMemoryRepositories'
import { StudioPage } from './StudioPage'

// This file uses its own container; production and other tests keep their repositories.
vi.mock('../../../../app/appContainer', async () => {
  const { createAppContainer } = await import('../../../../app/di/container')
  return { appContainer: createAppContainer() }
})

beforeEach(() => {
  Object.assign(appContainer.resolve('mockDb'), createMockDb())
  Range.prototype.getBoundingClientRect = () => new DOMRect() // jsdom에는 없음
})
afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const renderStudio = (path: string) => render(
  <Provider store={createAppStore({ role: 'user' })}>
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/studio/:id" element={<StudioPage />} /></Routes></MemoryRouter>
  </Provider>,
)

/** 본문 끝에 @를 두고 인물·사건 목록을 엽니다. */
async function openMentions() {
  const body = await screen.findByLabelText('원고 본문')
  body.innerHTML = '<p>그때 @</p>'
  const range = document.createRange()
  range.setStart(body.querySelector('p')!.firstChild!, 4)
  range.collapse(true)
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(range)
  fireEvent.keyUp(body, { key: '@' })
  const list = await screen.findByRole('listbox', { name: '연결할 인물·사건' })
  return { body, list, options: within(list).getAllByRole('option') }
}

describe('@ 멘션 목록은 combobox로 조작한다', () => {
  it('입력이 목록의 열림 상태와 연결을 알리고 항목마다 고유한 id가 있다', async () => {
    renderStudio('/studio/starlight')
    const closed = await screen.findByLabelText('원고 본문')
    expect(closed.getAttribute('role')).toBe('combobox')
    expect(closed.getAttribute('aria-expanded')).toBe('false')
    expect(closed.hasAttribute('aria-controls')).toBe(false)
    const { body, list, options } = await openMentions()
    expect(body.getAttribute('aria-expanded')).toBe('true')
    expect(list.id).toBeTruthy()
    expect(body.getAttribute('aria-controls')).toBe(list.id)
    expect(options.every((o) => o.id)).toBe(true)
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length)
    expect(options.every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true)
    expect(body.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('↑↓로 활성 항목을 옮기고 끝에서는 반대쪽으로 이어진다', async () => {
    renderStudio('/studio/starlight')
    const { body, options } = await openMentions()
    expect(fireEvent.keyDown(body, { key: 'ArrowDown' })).toBe(false)
    expect(body.getAttribute('aria-activedescendant')).toBe(options[0].id)
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(options.map((_, i) => String(i === 0)))
    fireEvent.keyDown(body, { key: 'ArrowDown' })
    expect(body.getAttribute('aria-activedescendant')).toBe(options[1].id)
    expect(fireEvent.keyDown(body, { key: 'ArrowUp' })).toBe(false)
    fireEvent.keyDown(body, { key: 'ArrowUp' })
    expect(body.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id)
    fireEvent.keyDown(body, { key: 'ArrowDown' })
    expect(body.getAttribute('aria-activedescendant')).toBe(options[0].id)
  })

  it('Enter는 활성 항목을 멘션으로 넣고 목록을 닫는다', async () => {
    renderStudio('/studio/starlight')
    const { body } = await openMentions()
    fireEvent.keyDown(body, { key: 'ArrowDown' })
    expect(fireEvent.keyDown(body, { key: 'Enter' })).toBe(false)
    expect(body.querySelector('.mention')?.textContent).toBe('@리안')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(body.getAttribute('aria-expanded')).toBe('false')
    expect(body.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('활성 항목이 없으면 Enter는 목록을 건드리지 않고 줄바꿈에 맡긴다', async () => {
    renderStudio('/studio/starlight')
    const { body } = await openMentions()
    expect(fireEvent.keyDown(body, { key: 'Enter' })).toBe(true)
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(body.querySelector('.mention')).toBeNull()
  })

  it('글을 더 입력하면 목록을 닫아 화살표·Enter가 편집을 가로채지 않는다', async () => {
    renderStudio('/studio/starlight')
    const { body } = await openMentions()
    fireEvent.keyDown(body, { key: 'ArrowDown' })
    fireEvent.input(body)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(body.getAttribute('aria-expanded')).toBe('false')
    expect(body.hasAttribute('aria-activedescendant')).toBe(false)
    expect(fireEvent.keyDown(body, { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(body, { key: 'Enter' })).toBe(true)
  })

  it('Esc로 닫고 마우스로 고르는 방식도 그대로 쓴다', async () => {
    renderStudio('/studio/starlight')
    const { body } = await openMentions()
    fireEvent.keyDown(body, { key: 'ArrowDown' })
    fireEvent.keyDown(body, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(body.getAttribute('aria-expanded')).toBe('false')
    expect(body.hasAttribute('aria-activedescendant')).toBe(false)
    fireEvent.keyUp(body, { key: '@' })
    fireEvent.mouseDown(within(await screen.findByRole('listbox')).getByRole('option', { name: /리안/ }))
    expect(body.querySelector('.mention')?.textContent).toBe('@리안')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('데모 집필실의 랜드마크와 제목', () => {
  it('원고 편집 영역은 건너뛰기 링크가 닿는 하나의 main이고 h1은 작품 제목이다', async () => {
    renderStudio('/studio/starlight')
    const editor = await screen.findByLabelText('원고 본문')
    const main = screen.getByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(main.contains(editor)).toBe(true)
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['별빛 서약의 탑'])
  })

  it('남의 소설 안내 화면도 하나의 main#main과 h1을 가진다', async () => {
    renderStudio('/studio/guunmong')
    await screen.findByRole('heading', { level: 1, name: '내 소설만 쓸 수 있어요' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main').id).toBe('main')
    expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
  })

  it('탭 제목에 집필실과 작품 제목을 쓴다', async () => {
    renderStudio('/studio/starlight')
    await screen.findByLabelText('원고 본문')
    expect(document.title).toBe('집필실 · 별빛 서약의 탑 · STORYFORK')
  })
})
