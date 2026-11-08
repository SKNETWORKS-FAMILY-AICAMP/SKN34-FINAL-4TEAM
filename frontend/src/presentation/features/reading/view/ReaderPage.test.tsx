// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

const scrollAt = (y: number) => act(() => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  window.dispatchEvent(new Event('scroll'))
})
const focus = (el: HTMLElement) => act(() => { el.focus() })

afterEach(() => {
  cleanup()
  document.title = 'STORYFORK'
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
})

async function openReader() {
  renderApp('/read/postman/1', createAppStore({ role: 'user' }))
  await screen.findByRole('heading', { name: '수취인 불명' })
  // 스크롤 리스너는 렌더 뒤 passive effect로 붙어, 부하가 크면 findBy가 풀린 뒤에도 아직 없고 스크롤 이벤트를 놓친다.
  // act 한 번으로는 Scheduler가 미룬 effect를 비우지 못하므로, 그 효과의 첫 실행이 채우는 진행률 바로 준비를 확인한다.
  await waitFor(() => expect(document.getElementById('prog')?.style.width).toBeTruthy())
  return [...document.querySelectorAll<HTMLElement>('[data-s]')]
}

describe('회차 뷰어 · 문장 키보드 접근', () => {
  it('문장은 이름이 있는 버튼이고 탭 정지점은 하나뿐이다', async () => {
    const s = await openReader()
    expect(s.length).toBeGreaterThan(3)
    expect(s.every((el) => el.getAttribute('role') === 'button')).toBe(true)
    expect(s.filter((el) => el.tabIndex === 0)).toEqual([s[0]])
    expect(s.slice(1).every((el) => el.tabIndex === -1)).toBe(true)
    screen.getByRole('button', { name: '“이건 어디로 가야 하지.”' })
    expect(document.getElementById(s[0].getAttribute('aria-describedby') ?? '')?.textContent).toContain('댓글·피드백')
  })

  it('방향키로 문장을 옮기면 탭 정지점이 따라가고 양 끝에서 멈추며 브라우저 단축키는 막지 않는다', async () => {
    const s = await openReader()
    focus(s[0])
    fireEvent.keyDown(s[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(s[0])
    fireEvent.keyDown(s[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(s[1])
    expect([s[0].tabIndex, s[1].tabIndex]).toEqual([-1, 0])
    fireEvent.keyDown(s[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(s[2])
    fireEvent.keyDown(s[2], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(s[1])
    expect(fireEvent.keyDown(s[1], { key: 'ArrowLeft', altKey: true })).toBe(true)
    expect(document.activeElement).toBe(s[1])
    const last = s[s.length - 1]
    focus(last)
    fireEvent.keyDown(last, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(last)
  })

  it('다른 회차로 가면 탭 정지점이 첫 문장으로 돌아와 본문에 Tab으로 들어갈 수 있다', async () => {
    const s = await openReader()
    focus(s[2])
    fireEvent.click(screen.getByRole('link', { name: '다음 화 ›' }))
    await screen.findByRole('heading', { name: '7구역의 소녀' })
    const next = [...document.querySelectorAll<HTMLElement>('[data-s]')]
    expect(next.filter((el) => el.tabIndex === 0)).toEqual([next[0]])
  })

  it('Enter로 문장 메뉴를 열면 첫 버튼에 포커스가 가고 Esc로 닫으면 문장으로 돌아온다', async () => {
    const s = await openReader()
    focus(s[1])
    expect(fireEvent.keyDown(s[1], { key: 'Enter' })).toBe(false)
    const menu = screen.getByRole('dialog', { name: '문장 작업' })
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: '💬 댓글 달기' }))
    expect(s[1].classList.contains('sel')).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(s[1])
    expect(document.querySelector('.s.sel')).toBeNull()
  })

  it('Space는 키를 뗄 때 문장 메뉴를 연다', async () => {
    const s = await openReader()
    focus(s[2])
    expect(fireEvent.keyDown(s[2], { key: ' ' })).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyUp(s[2], { key: ' ' })
    const menu = screen.getByRole('dialog', { name: '문장 작업' })
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: '💬 댓글 달기' }))
  })

  it('마우스로 다른 문장을 고르면 메뉴가 그 문장 쪽으로 옮겨 오고 첫 버튼에 포커스가 간다', async () => {
    const s = await openReader()
    fireEvent.click(s[1])
    const menu = screen.getByRole('dialog', { name: '문장 작업' })
    focus(s[2])
    fireEvent.click(s[2])
    expect(screen.getByRole('dialog', { name: '문장 작업' })).toBe(menu)
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: '💬 댓글 달기' }))
  })

  it('바깥을 누르면 문장 메뉴가 닫히고 메뉴 안이나 문장을 누르면 닫히지 않는다', async () => {
    const s = await openReader()
    fireEvent.click(s[1])
    const menu = screen.getByRole('dialog', { name: '문장 작업' })
    fireEvent.pointerDown(within(menu).getByRole('button', { name: /문장 공유/ }))
    fireEvent.pointerDown(s[2])
    expect(screen.getByRole('dialog', { name: '문장 작업' })).toBe(menu)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.s.sel')).toBeNull()
  })

  it('문장 공유를 누르면 메뉴가 닫히고 포커스가 문장으로 돌아온다', async () => {
    const s = await openReader()
    fireEvent.click(s[1])
    fireEvent.click(screen.getByRole('button', { name: /문장 공유/ }))
    expect(screen.queryByRole('dialog', { name: '문장 작업' })).toBeNull()
    expect(document.activeElement).toBe(s[1])
  })

  it('다른 시트(Ctrl K)가 열리면 문장 메뉴는 닫힌다', async () => {
    const s = await openReader()
    fireEvent.click(s[1])
    screen.getByRole('dialog', { name: '문장 작업' })
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await screen.findByRole('dialog', { name: '빠른 이동' })
    expect(screen.queryByRole('dialog', { name: '문장 작업' })).toBeNull()
  })

  it.each([
    ['💬 댓글 달기', '문장에 댓글 달기'],
    ['✉ 피드백 보내기', '피드백 보내기'],
  ])('%s 시트를 닫으면 포커스가 고른 문장으로 돌아온다', async (button, dialog) => {
    const s = await openReader()
    fireEvent.click(s[2])
    fireEvent.click(screen.getByRole('button', { name: button }))
    fireEvent.click(within(screen.getByRole('dialog', { name: dialog })).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(s[2])
  })

  it('보기 설정 시트를 닫으면 포커스는 보기 설정 버튼으로 돌아온다', async () => {
    await openReader()
    const aa = screen.getByRole('button', { name: '보기 설정' })
    focus(aa)
    fireEvent.click(aa)
    screen.getByRole('dialog', { name: '보기 설정' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(aa)
  })
})

describe('회차 뷰어 · 숨긴 바와 구조', () => {
  it('스크롤로 숨긴 상·하단 바는 inert로 포커스·보조기기에서 빠지고 다시 보이면 풀린다', async () => {
    await openReader()
    const [top, bottom] = [document.getElementById('rtop')!, document.getElementById('rbot')!]
    expect([top, bottom].map((bar) => bar.hasAttribute('inert'))).toEqual([false, false])
    scrollAt(400)
    expect([top, bottom].map((bar) => [bar.classList.contains('hide'), bar.hasAttribute('inert')])).toEqual([[true, true], [true, true]])
    scrollAt(300)
    expect([top, bottom].map((bar) => [bar.classList.contains('hide'), bar.hasAttribute('inert')])).toEqual([[false, false], [false, false]])
  })

  it('포커스가 들어 있는 바는 숨기지 않는다', async () => {
    await openReader()
    const [top, bottom] = [document.getElementById('rtop')!, document.getElementById('rbot')!]
    focus(within(top).getByRole('button', { name: '공유' }))
    scrollAt(400)
    expect([top, bottom].map((bar) => [bar.classList.contains('hide'), bar.hasAttribute('inert')])).toEqual([[false, false], [true, true]])
  })

  it('본문은 id가 main인 랜드마크 하나이고 h1이 하나다', async () => {
    const s = await openReader()
    const mains = document.querySelectorAll('main')
    expect(mains).toHaveLength(1)
    expect(mains[0].id).toBe('main')
    expect(mains[0].getAttribute('tabindex')).toBe('-1')
    expect(mains[0].contains(s[0])).toBe(true)
    const h1 = screen.getAllByRole('heading', { level: 1 })
    expect(h1.map((h) => h.textContent)).toEqual(['회색 도시의 우편배달부 1화'])
    expect(mains[0].contains(h1[0])).toBe(true)
  })

  it('탭 제목은 작품 제목과 회차이며 본문은 들어가지 않는다', async () => {
    await openReader()
    await waitFor(() => expect(document.title).toBe('회색 도시의 우편배달부 1화 · STORYFORK'))
  })
})
