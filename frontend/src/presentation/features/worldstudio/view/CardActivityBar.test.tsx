// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CardPane, PaneBadge } from '../viewmodel/cardPanels'
import { CardActivityBar } from './CardActivityBar'

afterEach(cleanup)

const bar = (pane: CardPane, over: { badges?: Partial<Record<CardPane, PaneBadge>>; listOpen?: boolean } = {}) => {
  const onPane = vi.fn(), onList = vi.fn()
  render(<CardActivityBar pane={pane} paneId="body" badges={over.badges ?? {}} onPane={onPane} listOpen={over.listOpen ?? true} listId="cards" onList={onList} />)
  return { onPane, onList }
}
const tabs = () => screen.getAllByRole('tab')

it('맨 위에 설정 카드 목록 토글이 있고 구분선 아래 세로 탭 줄(개요·문서·관계·버전·공개 순서)이 이어지며 고른 화면만 aria-selected이고 모두 본문을 가리킨다(툴팁은 이름)', () => {
  bar('relations')
  const bars = document.querySelector('.world-activity')!
  expect(bars.firstElementChild!.getAttribute('title')).toBe('설정 카드 목록') // 목록 토글이 탭보다 위다
  expect(bars.querySelector('.world-activity-sep')).toBeTruthy()
  const list = screen.getByRole('tablist', { name: '카드 화면' })
  expect(list.getAttribute('aria-orientation')).toBe('vertical')
  expect(within(list).queryByRole('button')).toBeNull() // 탭 줄 안에는 탭만 있다(목록 토글은 밖)
  expect(tabs().map((t) => t.getAttribute('title'))).toEqual(['개요', '문서', '관계', '버전', '공개 순서'])
  expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false'])
  expect(new Set(tabs().map((t) => t.getAttribute('aria-controls')))).toEqual(new Set(['body']))
  expect(tabs().map((t) => t.getAttribute('id'))).toEqual(['body-tab-overview', 'body-tab-doc', 'body-tab-relations', 'body-tab-versions', 'body-tab-order'])
})

it('목록 토글은 탭이 아니라 버튼이다: 열려 있으면 aria-expanded이고 목록을 가리키며, 접히면 가리키지 않는다. 누르면 알린다', () => {
  const { onList } = bar('doc', { listOpen: true })
  const toggle = screen.getByRole('button', { name: '설정 카드 목록' })
  expect([toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-controls')]).toEqual(['true', 'cards'])
  fireEvent.click(toggle)
  expect(onList).toHaveBeenCalledTimes(1)
  cleanup()
  bar('doc', { listOpen: false })
  const closed = screen.getByRole('button', { name: '설정 카드 목록' })
  expect([closed.getAttribute('aria-expanded'), closed.getAttribute('aria-controls')]).toEqual(['false', null])
})

it('아이콘 버튼의 읽는 이름에 배지 수가 들어가고, 배지 글자는 화면에만 보이며(aria-hidden), 수가 없는 배지는 점이다', () => {
  bar('doc', { badges: { relations: { text: '12', label: '12개' }, versions: { text: '', label: '저장 안 됨' }, order: { text: '5', label: '5건' } } })
  expect(tabs().map((t) => t.getAttribute('aria-label'))).toEqual(['개요', '문서', '관계 12개', '버전 저장 안 됨', '공개 순서 5건'])
  const badge = (name: RegExp) => screen.getByRole('tab', { name }).querySelector('.world-activity-badge')!
  expect(badge(/^관계/).textContent).toBe('12')
  expect(badge(/^관계/).getAttribute('aria-hidden')).toBe('true')
  expect(badge(/^버전/).className).toContain('dot')
  expect(badge(/^버전/).textContent).toBe('')
  expect(badge(/^공개 순서/).className).toContain('warn')
  expect(screen.getByRole('tab', { name: '개요' }).querySelector('.world-activity-badge')).toBeNull() // 배지가 없는 화면
})

it('아이콘 아래에는 늘 보이는 짧은 글자 라벨이 있다: 목록 토글은 카드 목록, 탭은 개요·문서·관계·버전·공개 순서이고, 읽는 이름(aria-label)과 겹치지 않게 라벨은 aria-hidden이다', () => {
  bar('doc', { badges: { relations: { text: '12', label: '12개' }, versions: { text: '', label: '저장 안 됨' } } })
  const label = (button: HTMLElement) => button.querySelector('.world-activity-label')!
  const toggle = screen.getByRole('button', { name: '설정 카드 목록' }) // 화면 라벨 '카드 목록'이 읽는 이름에 들어 있다(label in name)
  expect([label(toggle).textContent, label(toggle).getAttribute('aria-hidden')]).toEqual(['카드 목록', 'true'])
  expect(tabs().map((t) => label(t).textContent)).toEqual(['개요', '문서', '관계', '버전', '공개 순서'])
  expect(tabs().every((t) => label(t).getAttribute('aria-hidden') === 'true')).toBe(true)
  expect(tabs().map((t) => t.getAttribute('aria-label'))).toEqual(['개요', '문서', '관계 12개', '버전 저장 안 됨', '공개 순서']) // 읽는 이름은 그대로(배지 수 포함)
})

it('아이콘과 배지는 한 덩어리(.world-activity-icon)라 배지가 아이콘 모서리에 붙고 글자 라벨은 그 밖이라 라벨을 가리지 않는다', () => {
  bar('doc', { badges: { relations: { text: '12', label: '12개' }, versions: { text: '', label: '저장 안 됨' } } })
  const relations = screen.getByRole('tab', { name: '관계 12개' })
  expect(relations.querySelector('.world-activity-icon svg')).toBeTruthy()
  expect(relations.querySelector('.world-activity-icon .world-activity-badge')!.textContent).toBe('12')
  expect(relations.querySelector('.world-activity-label')!.closest('.world-activity-icon')).toBeNull()
  expect(screen.getByRole('tab', { name: /^버전/ }).querySelector('.world-activity-icon .world-activity-badge.dot')).toBeTruthy()
  expect(Array.from(relations.children, (child) => child.className)).toEqual(['world-activity-icon', 'world-activity-label']) // 아이콘 아래 라벨 순서
})

it('누르면 그 화면을 알린다', () => {
  const { onPane } = bar('doc')
  fireEvent.click(screen.getByRole('tab', { name: '버전' }))
  expect(onPane).toHaveBeenLastCalledWith('versions')
  fireEvent.click(screen.getByRole('tab', { name: '개요' }))
  expect(onPane).toHaveBeenLastCalledWith('overview')
})

it('Tab 자리는 고른 아이콘 하나다', () => {
  bar('versions')
  expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, -1, 0, -1])
})

it('방향키 ↑↓(←→)로 초점이 이웃 아이콘으로 옮겨 가고(고르지는 않는다) 처음·끝에서 이어지며, Home·End는 처음·끝으로 간다', () => {
  const { onPane } = bar('overview')
  const focus = (index: number) => { tabs()[index].focus(); return tabs()[index] }
  fireEvent.keyDown(focus(0), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(tabs()[1])
  fireEvent.keyDown(tabs()[1], { key: 'ArrowRight' })
  expect(document.activeElement).toBe(tabs()[2])
  fireEvent.keyDown(tabs()[2], { key: 'ArrowUp' })
  expect(document.activeElement).toBe(tabs()[1])
  fireEvent.keyDown(focus(0), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(tabs()[4]) // 처음에서 위로 가면 끝
  fireEvent.keyDown(tabs()[4], { key: 'ArrowDown' })
  expect(document.activeElement).toBe(tabs()[0])
  fireEvent.keyDown(tabs()[0], { key: 'End' })
  expect(document.activeElement).toBe(tabs()[4])
  fireEvent.keyDown(tabs()[4], { key: 'Home' })
  expect(document.activeElement).toBe(tabs()[0])
  expect(onPane).not.toHaveBeenCalled() // 초점만 옮기고 고르는 것은 Enter·Space(버튼의 누르기)다
})
