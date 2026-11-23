// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { MyCommentsReports } from './MyCommentsReports'

// 서버 제보·수정 제안은 비워 두고 데모 피드백 한 건만 둔다(세 구획의 제목 레벨을 모두 보려는 것이다).
beforeEach(() => {
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listMine').mockResolvedValue([])
  vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'mine').mockResolvedValue([])
  vi.spyOn(appContainer.resolve('libraryUseCase'), 'getReports').mockResolvedValue([{ id: 'd1', title: '구운몽', n: 2, type: '오탈자', status: '확인 중', text: '본문 오탈자예요', reply: '확인해 볼게요' }] as never)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const open = (embedded?: boolean) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><MyCommentsReports embedded={embedded} /></MemoryRouter></Provider>)

it('쪽(/content?view=reports)에서는 내 댓글·제보가 쪽 제목(h1)이고 구획 제목(내 제보·내 수정 제안·데모 작품 피드백)은 h2다', async () => {
  open()
  expect(screen.getByRole('heading', { level: 1, name: '내 댓글·제보' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '내 댓글·제보' }).contains(screen.getByRole('heading', { level: 1 }))).toBe(true)
  expect(await screen.findByRole('heading', { level: 2, name: '내 제보 0' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: '내 수정 제안' })).toBeTruthy()
  expect(await screen.findByRole('heading', { level: 2, name: /데모 작품 피드백/ })).toBeTruthy()
})

it('작품 관리 탭 안(embedded)에서는 쪽 제목(h1)을 그리지 않고 구획 제목이 h3로 내려가, 탭 제목(h2) 하나만 제목 구조의 위에 남는다', async () => {
  open(true)
  expect(await screen.findByRole('heading', { level: 3, name: '내 제보 0' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 3, name: '내 수정 제안' })).toBeTruthy()
  expect(await screen.findByRole('heading', { level: 3, name: /데모 작품 피드백/ })).toBeTruthy()
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  expect(screen.getByRole('region', { name: '내 댓글·제보' })).toBeTruthy() // 이름 있는 구역은 남는다
})
