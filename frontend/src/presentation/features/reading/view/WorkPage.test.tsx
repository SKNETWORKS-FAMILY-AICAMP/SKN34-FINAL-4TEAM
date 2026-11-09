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

it('소설 상세는 id가 main인 랜드마크 하나와 h1 하나를 갖고 탭 제목은 작품 제목이다', async () => {
  renderApp('/work/postman', createAppStore({ role: 'user' }))
  const title = await screen.findByRole('heading', { name: '회색 도시의 우편배달부', level: 1 })
  expect(expectOneMain().contains(title)).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('회색 도시의 우편배달부 · STORYFORK'))
})

it('볼 수 없는 소설 안내도 main 하나와 h1 하나이며 탭 제목은 일반 화면 이름이다', async () => {
  renderApp('/work/nope')
  await screen.findByRole('heading', { name: '소설을 찾을 수 없거나 볼 수 없어요.', level: 1 })
  expectOneMain()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('소설 상세 · STORYFORK'))
})
