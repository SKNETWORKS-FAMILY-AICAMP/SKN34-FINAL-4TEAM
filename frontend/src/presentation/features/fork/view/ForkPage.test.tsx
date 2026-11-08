// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const user = () => createAppStore({ role: 'user' })
const expectOneMain = () => {
  const mains = document.querySelectorAll('main')
  expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main')
  expect(mains[0].getAttribute('tabindex')).toBe('-1')
  return mains[0]
}

it('회차 선택 버튼은 눌림 상태를 알린다', async () => {
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  const epc = within(document.getElementById('epc')!)
  epc.getByRole('button', { name: /1화 끝에서/, pressed: false })
  epc.getByRole('button', { name: /2화 끝에서/, pressed: true })
  fireEvent.click(epc.getByRole('button', { name: /3화 끝에서/ }))
  epc.getByRole('button', { name: /2화 끝에서/, pressed: false })
  epc.getByRole('button', { name: /3화 끝에서/, pressed: true })
})

it('포크 폼은 main 하나와 h1 하나를 갖고 탭 제목은 포크 만들기이다', async () => {
  renderApp('/fork/guunmong', user())
  const h1 = await screen.findByRole('heading', { name: '「구운몽」 포크', level: 1 })
  expect(expectOneMain().contains(h1)).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('포크 만들기 · STORYFORK'))
})

it('포크를 만든 뒤 완료 화면과 이미 포크한 안내도 main 하나와 h1 하나를 갖는다', async () => {
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  fireEvent.click(within(document.getElementById('epc')!).getByRole('button', { name: /3화 끝에서/ }))
  fireEvent.click(screen.getByRole('button', { name: '포크 소설 시작하기 →' }))
  await screen.findByRole('heading', { name: '포크 소설을 만들었어요' })
  expectOneMain()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['포크 소설 생성 완료'])
  await waitFor(() => expect(document.title).toBe('포크 소설 · STORYFORK'))
  cleanup()

  renderApp('/fork/guunmong', user())
  const h1 = await screen.findByRole('heading', { name: '이미 포크한 원작이에요', level: 1 })
  expect(expectOneMain().contains(h1)).toBe(true)
  await waitFor(() => expect(document.title).toBe('포크 만들기 · STORYFORK'))
})
