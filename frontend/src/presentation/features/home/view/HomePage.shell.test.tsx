// @vitest-environment jsdom
// React 조립 회귀: CI 통합 계층에서만 실행한다.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { stubWorkSearch } from '../../../../test/stubWorkSearch'
import { HomePage } from './HomePage'

beforeEach(() => { stubWorkSearch() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

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

it('실시간 인기·급상승은 최근 24시간 조회 기준임을 알리고 집계가 비면 빈 상태를 보여 준다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'ranking').mockResolvedValue([])
  renderHome()
  const top = await screen.findByLabelText('실시간 인기 TOP10')
  expect(within(top).getByText('24시간 조회').getAttribute('title')).toBe('최근 24시간 조회 수 순')
  expect(within(top).getByText('최근 24시간 동안 조회된 소설이 아직 없어요.')).toBeTruthy()
  expect(within(top).queryByRole('list')).toBeNull()
  screen.getByText('최근 24시간 동안 조회가 늘어난 소설이 아직 없어요.')
  expect(screen.queryByText(/데모 데이터/)).toBeNull()
})

it('순위 조회가 실패하면 빈 목록으로 숨기지 않고 안내하며 나머지 홈은 그대로 보여 준다', async () => {
  vi.spyOn(appContainer.resolve('workSearchRepository'), 'ranking').mockRejectedValue(new Error('offline'))
  renderHome()
  await screen.findByText('방금 올라온 포크 소설')
  expect(screen.getAllByText('순위를 불러오지 못했어요.')).toHaveLength(2)
  expect(within(screen.getByLabelText('실시간 인기 TOP10')).queryByRole('list')).toBeNull()
  expect(screen.queryByText('최근 24시간 동안 조회된 소설이 아직 없어요.')).toBeNull()
})
