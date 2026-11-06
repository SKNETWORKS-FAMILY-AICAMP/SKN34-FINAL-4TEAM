// @vitest-environment jsdom
// React 조립 회귀: CI 통합 계층에서만 실행한다.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { HomePage } from './HomePage'

afterEach(cleanup)

const renderHome = () => render(<Provider store={createAppStore()}><MemoryRouter useTransitions={false}><HomePage /></MemoryRouter></Provider>)

it('본문 랜드마크 하나 안에서 기존 #home 구성을 유지한다', async () => {
  renderHome()
  await screen.findByText('방금 올라온 포크 소설')
  const main = screen.getByRole('main')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
  expect(main.querySelector(':scope > #home > h1.sr-only')?.textContent).toBe('STORYFORK')
  expect(main.querySelectorAll('#home .chips, #home .hero, #home .t10')).toHaveLength(3)
})

it('홈의 탭 제목은 태그라인이고 화면을 떠나면 기본 제목으로 돌아간다', async () => {
  const view = renderHome()
  await waitFor(() => expect(document.title).toBe('원작을 나만의 이야기로 · STORYFORK'))
  view.unmount()
  expect(document.title).toBe('STORYFORK')
})
