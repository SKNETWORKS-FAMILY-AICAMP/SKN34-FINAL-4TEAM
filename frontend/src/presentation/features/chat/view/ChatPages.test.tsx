// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const expectOneMain = () => {
  const mains = document.querySelectorAll('main')
  expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main')
  expect(mains[0].getAttribute('tabindex')).toBe('-1')
  return mains[0]
}
const h1s = () => screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)

it('캐릭터챗 목록은 main 하나와 h1 하나를 갖고 탭 제목은 캐릭터 챗이다', async () => {
  renderApp('/chat', createAppStore({ role: 'user' }))
  const title = await screen.findByRole('heading', { name: '캐릭터챗', level: 1 })
  expect(expectOneMain().contains(title)).toBe(true)
  expect(h1s()).toEqual(['캐릭터챗'])
  await waitFor(() => expect(document.title).toBe('캐릭터 챗 · STORYFORK'))
})

it('대화방도 main 하나와 h1 하나를 갖는다', async () => {
  renderApp('/chat/guunmong/' + encodeURIComponent('성진'), createAppStore({ role: 'user' }))
  await screen.findByText('소승 성진이라 합니다. 무엇이 궁금하십니까?')
  expectOneMain()
  expect(h1s()).toEqual(['캐릭터 챗'])
  await waitFor(() => expect(document.title).toBe('캐릭터 챗 · STORYFORK'))
})
