// @vitest-environment jsdom
import '../../../test/fixtureApp'
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../app/appContainer'
import { createAppStore } from '../../../app/store'
import type { PublicWorldCardHit, PublicWorldSummary } from '../../../domain/entities/publicWorld'
import { QuickJump } from './QuickJump'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
// 입력 지연(250ms)을 기다리는 단언이 느린 실행 환경에서도 버티도록 기본 대기(1초)를 늘린다.
configure({ asyncUtilTimeout: 3000 })

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const open = () => {
  render(<Provider store={createAppStore()}><MemoryRouter><QuickJump /><Where /></MemoryRouter></Provider>)
  act(() => { window.dispatchEvent(new Event('sf-quick')) })
}

it('입력과 목록이 combobox·listbox·option으로 연결되고 방향키가 활성 항목을 알린다', async () => {
  open()
  const input = screen.getByRole('combobox', { name: '소설·세계관·설정 카드·캐릭터챗 검색' })
  const options = await screen.findAllByRole('option')
  const list = screen.getByRole('listbox')
  expect(input.getAttribute('aria-expanded')).toBe('true')
  expect(input.getAttribute('aria-controls')).toBe(list.id)
  expect(input.getAttribute('aria-autocomplete')).toBe('list')
  expect(new Set(options.map((o) => o.id)).size).toBe(options.length)
  expect(options.every((o) => o.id && list.contains(o))).toBe(true)
  expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)
  expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(options.map((_, i) => String(i === 0)))
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id)
  expect(options[1].getAttribute('aria-selected')).toBe('true')
  expect(options[0].getAttribute('aria-selected')).toBe('false')
})

it('목록이 비어 있으면 닫힘으로 알리고 옵션이 아닌 안내만 보여 준다', () => {
  open()
  const input = screen.getByRole('combobox', { name: '소설·세계관·설정 카드·캐릭터챗 검색' })
  expect(input.getAttribute('aria-expanded')).toBe('false')
  expect(input.hasAttribute('aria-activedescendant')).toBe(false)
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  expect(screen.getByText('검색 결과가 없어요.')).toBeTruthy()
})

it('한글 조합 중 Enter는 이동하지 않고 조합이 끝난 Enter만 이동한다', async () => {
  open()
  const input = screen.getByRole('combobox', { name: '소설·세계관·설정 카드·캐릭터챗 검색' })
  fireEvent.change(input, { target: { value: '구운몽' } })
  const options = await waitFor(() => { const o = screen.getAllByRole('option'); expect(o.length).toBeGreaterThan(1); return o })
  const selected = () => input.getAttribute('aria-activedescendant')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(selected()).toBe(options[1].id)
  // 조합 중 방향키는 선택을 바꾸지 않는다 (키마다 확인해야 ↓↑가 상쇄되지 않는다)
  for (const key of ['ArrowDown', 'ArrowUp']) {
    fireEvent.keyDown(input, { key, isComposing: true })
    expect(selected()).toBe(options[1].id)
  }
  // 조합 중 Enter와 Safari의 조합 확정 Enter(isComposing=false, keyCode=229)는 이동하지 않는다
  for (const init of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
    fireEvent.keyDown(input, { key: 'Enter', ...init })
    expect(screen.queryByRole('dialog')).not.toBeNull()
  }
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByTestId('where').textContent).toBe('/work/guunmong')
})

// ── 세계관·설정 카드 검색 (#505) ──────────────────────────────────────────────
const NAME = '소설·세계관·설정 카드·캐릭터챗 검색'
const NOTE = '세계관·설정 카드를 불러오지 못했어요'
const worldCases = () => appContainer.resolve('publicWorldUseCase')
const world = (id: string, name: string, authorNickname = '달무리'): PublicWorldSummary => ({ id, name, description: '', genre: 'fantasy', authorNickname, cardCount: 7, relationshipCount: 3, publishedAt: '2026-11-18T00:00:00Z' })
const hit = (cardId: string, title: string): PublicWorldCardHit => ({ worldId: 'moonhalo-isles', worldName: '달무리 군도', cardId, title, cardType: 'character', aliases: [], tags: [], imageId: null })
const worldPage = (...items: PublicWorldSummary[]) => ({ items, page: 0, size: 3, total: items.length })
const cardPage = (...items: PublicWorldCardHit[]) => ({ items, page: 0, size: 3, total: items.length })
const typeInto = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: NAME }), { target: { value } })
const kinds = () => screen.getAllByRole('option').map((o) => o.querySelector('.chip')?.textContent)

it('안내 문구는 소설·세계관·설정 카드·캐릭터챗 검색이고 첫 줄은 작품·세계관·설정 카드에서 찾는다고 알린다', async () => {
  open()
  expect(screen.getByRole('combobox', { name: NAME }).getAttribute('placeholder')).toBe(NAME + ' (Enter: 전체 결과 보기)')
  typeInto('구운몽')
  const first = (await screen.findAllByRole('option'))[0]
  expect(first.textContent).toContain('‘구운몽’ 검색 결과 모두 보기')
  expect(first.textContent).toContain('Enter · 작품·세계관·설정 카드에서 찾기')
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(screen.getByTestId('where').textContent).toBe('/search?q=' + encodeURIComponent('구운몽')) // 이동은 전체 탭이다
})

it('검색어가 없으면 세계관·설정 카드를 요청하지 않는다', async () => {
  const searchWorlds = vi.spyOn(worldCases(), 'searchWorlds')
  const searchCards = vi.spyOn(worldCases(), 'searchCards')
  open()
  await screen.findAllByRole('option')
  typeInto('구운몽')
  typeInto('  ')
  await act(async () => { await new Promise((done) => setTimeout(done, 350)) })
  expect([searchWorlds.mock.calls.length, searchCards.mock.calls.length]).toEqual([0, 0])
})

it('입력이 이어지는 동안은 요청하지 않고 멈춘 뒤 한 번만 3개씩 요청하며, 검색어를 바꾸면 이전 요청은 바로 취소한다', async () => {
  const signals: AbortSignal[] = []
  const searchWorlds = vi.spyOn(worldCases(), 'searchWorlds').mockImplementation((_query, signal) => { signals.push(signal!); return new Promise(() => {}) })
  const searchCards = vi.spyOn(worldCases(), 'searchCards').mockImplementation(() => new Promise(() => {}))
  open()
  for (const value of ['안', '안개', '안개비']) typeInto(value)
  await act(async () => { await new Promise((done) => setTimeout(done, 60)) })
  expect(searchWorlds).not.toHaveBeenCalled() // 250ms가 지나기 전
  await waitFor(() => expect(searchWorlds).toHaveBeenCalledTimes(1))
  expect(searchWorlds).toHaveBeenCalledWith({ q: '안개비', page: 0, size: 3 }, expect.any(AbortSignal))
  expect(searchCards).toHaveBeenCalledWith({ q: '안개비', page: 0, size: 3 }, expect.any(AbortSignal))
  expect(signals[0].aborted).toBe(false)
  typeInto('안개나')
  expect(signals[0].aborted).toBe(true) // 새 입력 즉시
  await waitFor(() => expect(searchWorlds).toHaveBeenCalledTimes(2))
  expect(searchWorlds).toHaveBeenLastCalledWith({ q: '안개나', page: 0, size: 3 }, expect.any(AbortSignal))
  cleanup() // 시트를 닫으면(화면을 떠나면) 진행 중인 요청도 취소한다
  expect(signals[1].aborted).toBe(true)
})

it('세계관·설정 카드 결과는 작품 후보 뒤에 세계관·설정 카드 배지로 붙고 Enter·클릭으로 각자의 페이지로 이동한다', async () => {
  vi.spyOn(worldCases(), 'searchWorlds').mockResolvedValue(worldPage(world('moonhalo-isles', '달무리 군도'), world('tide-compass', '조수의 나침반', '물때서기')))
  vi.spyOn(worldCases(), 'searchCards').mockResolvedValue(cardPage(hit('1', '조석신 하엘')))
  open()
  typeInto('구운몽')
  await screen.findByText('달무리 군도')
  const all = kinds()
  expect(all[0]).toBe('검색')
  expect(all.slice(-3)).toEqual(['세계관', '세계관', '설정 카드'])
  expect(all.slice(1, -3).length).toBeGreaterThan(0)
  expect(all.slice(1, -3).every((kind) => kind && !['세계관', '설정 카드'].includes(kind))).toBe(true) // 작품 후보가 먼저
  screen.getByText('달무리 · 설정 카드 7개')
  screen.getByText('달무리 군도 · 인물')
  fireEvent.click(screen.getByText('조수의 나침반'))
  expect(screen.getByTestId('where').textContent).toBe('/worlds/tide-compass')
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => { window.dispatchEvent(new Event('sf-quick')) })
  typeInto('구운몽')
  await screen.findByText('조석신 하엘')
  const input = screen.getByRole('combobox')
  for (let n = screen.getAllByRole('option').length - 1; n > 0; n--) fireEvent.keyDown(input, { key: 'ArrowDown' }) // 마지막 항목까지
  expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option').at(-1)!.id)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByTestId('where').textContent).toBe('/worlds/moonhalo-isles/cards/1')
})

it('고른 항목은 세계관·설정 카드 결과가 뒤늦게 붙어도 그대로이고 Enter가 그 항목으로 간다', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((done) => { release = done })
  vi.spyOn(worldCases(), 'searchWorlds').mockImplementation(async () => { await gate; return worldPage(world('moonhalo-isles', '달무리 군도')) })
  vi.spyOn(worldCases(), 'searchCards').mockResolvedValue(cardPage(hit('1', '조석신 하엘')))
  open()
  typeInto('구운몽')
  const options = await waitFor(() => { const o = screen.getAllByRole('option'); expect(o.length).toBeGreaterThan(2); return o })
  const input = screen.getByRole('combobox')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  const picked = options[2].textContent
  expect(input.getAttribute('aria-activedescendant')).toBe(options[2].id)
  await act(async () => { await new Promise((done) => setTimeout(done, 300)); release(); await gate })
  await screen.findByText('달무리 군도')
  const after = screen.getAllByRole('option')
  expect(after[2].textContent).toBe(picked)
  expect(after[2].getAttribute('aria-selected')).toBe('true')
  expect(input.getAttribute('aria-activedescendant')).toBe(after[2].id)
  expect(after.map((o) => o.getAttribute('aria-selected')).filter((v) => v === 'true')).toHaveLength(1)
})

it('한 묶음이 실패하면 그 묶음만 빼고 목록 끝에 안내 한 줄을 보이고, 둘 다 실패해도 작품 후보와 이동은 그대로다', async () => {
  vi.spyOn(worldCases(), 'searchWorlds').mockRejectedValue(new Error('offline'))
  vi.spyOn(worldCases(), 'searchCards').mockResolvedValue(cardPage(hit('1', '조석신 하엘')))
  open()
  typeInto('구운몽')
  const note = await screen.findByText(NOTE)
  expect(kinds().at(-1)).toBe('설정 카드')
  expect(kinds()).not.toContain('세계관')
  expect(screen.getByRole('listbox').compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // 목록 뒤
  expect(screen.queryAllByText(NOTE)).toHaveLength(1)
  cleanup()
  vi.spyOn(worldCases(), 'searchCards').mockRejectedValue(new Error('offline'))
  open()
  typeInto('구운몽')
  await screen.findByText(NOTE)
  expect(kinds()).not.toContain('설정 카드')
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
  expect(screen.getByTestId('where').textContent).toBe('/work/guunmong')
})

it('모두 읽으면 실패 안내는 없고, 메모리 저장소(--mode mockup)도 같은 동작으로 세계관·설정 카드를 찾는다', async () => {
  open()
  typeInto('하엘')
  await screen.findByRole('option', { name: /조석신 하엘/ })
  expect(screen.queryByText(NOTE)).toBeNull()
  expect(kinds()).toContain('설정 카드')
  fireEvent.click(screen.getByRole('option', { name: /조석신 하엘/ }))
  expect(screen.getByTestId('where').textContent).toBe('/worlds/moonhalo-isles/cards/1')
})
