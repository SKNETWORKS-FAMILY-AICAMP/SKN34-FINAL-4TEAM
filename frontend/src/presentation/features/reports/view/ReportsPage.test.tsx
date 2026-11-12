// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { ReportsPage } from './ReportsPage'

// 상단바(Gnb)는 이 테스트와 무관하니 비우고, 공용 Footer는 실제 것을 그린다.
vi.mock('../../../shared/shell/Gnb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/shell/Gnb')>()),
  Gnb: () => null,
}))

afterEach(cleanup)

it('내 신고 화면은 본문(main) 뒤에 공용 푸터를 최상위 형제로 둔다', async () => {
  const { container } = render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><ReportsPage /></MemoryRouter></Provider>)
  // 토큰 없는 단위 환경이라 신고 목록 조회가 실패한다. 그 비동기 갱신을 테스트 안에서 끝낸다.
  await screen.findByRole('alert')
  const footer = screen.getByRole('contentinfo')
  expect(within(footer).getByText('SKN34 최종 프로젝트 4팀')).toBeTruthy()
  expect(footer.parentElement).toBe(container)
  expect(screen.getByRole('main').nextElementSibling).toBe(footer)
})
