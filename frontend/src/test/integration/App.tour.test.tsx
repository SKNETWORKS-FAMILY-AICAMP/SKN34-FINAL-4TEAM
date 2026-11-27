// @vitest-environment jsdom
import '../fixtureApp'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import '../testLocks'
import App from '../../App'
import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import { forgetSession, login } from '../../data/api/auth'
import { isTourSeen, markTourSeen, tourKey, tourScreens } from '../../presentation/shared/tour/tourPrefs'

// fixtureApp은 앱 전체를 그리는 테스트가 투어에 가려지지 않게 투어가 있는 네 화면을 모두 본 것으로 시작한다. 이 파일은 그 기억을 지워 앱의 자동 시작을 검사한다.
const toursOn = () => tourScreens.forEach((screenKey) => localStorage.removeItem(tourKey(screenKey)))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); forgetSession(); tourScreens.forEach(markTourSeen) })

/** 실제 앱(main.tsx)처럼 StrictMode로 그리면 자동 시작 effect가 곧바로 두 번 돈다. */
const renderAt = (path: string, strict = false) => {
  const app = <Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>
  return render(strict ? <StrictMode>{app}</StrictMode> : app)
}

it('fixtureApp은 투어가 있는 작가 도구 네 화면을 모두 본 것으로 시작한다', () => {
  expect(tourScreens).toHaveLength(4)
  expect(tourScreens.every(isTourSeen)).toBe(true)
})

// 투어는 작가 도구(작품 관리·집필실·세계관 관리·설정 카드)에만 있다. 독자 화면과 피드백함에는 사용법 버튼이 없다.
// 지연 로딩 화면(소설 상세·독서)은 여러 테스트를 함께 돌리면 첫 import가 기본 1초를 넘을 수 있어 다른 통합 테스트처럼 5초를 기다린다.
it.each([
  ['소설 상세', '/work/postman', () => screen.findByRole('link', { name: '읽기 시작' }, { timeout: 5000 })],
  ['독서 화면', '/read/postman/1', () => screen.findByRole('heading', { name: '수취인 불명' }, { timeout: 5000 })],
  ['Fork 생성', '/fork/guunmong', () => screen.findByRole('heading', { name: '「구운몽」 포크' }, { timeout: 5000 })],
  ['작가 피드백함', '/inbox', () => screen.findByRole('heading', { name: /독자 피드백함/ }, { timeout: 5000 })],
])('%s에는 사용법 버튼이 없다', async (_name, path, ready) => {
  vi.spyOn(appContainer.resolve('feedbackReportUseCase'), 'listInbox').mockResolvedValue([])
  vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'inbox').mockResolvedValue([])
  renderAt(path)
  await ready()
  expect(screen.queryByRole('button', { name: '사용법' })).toBeNull()
})

it('작품 관리는 앱에서 처음 열면 투어(세계관 연결 → 이야기 분기 → 집필 방식)가 저절로 뜨고, 끝낸 뒤에는 사용법 버튼으로 다시 연다(#971)', async () => {
  toursOn()
  const owned = { id: 'w', title: '옛 제목', summary: '옛 소개', visibility: 'private', allowFork: false, allowForkPublication: false, revision: 0, source: null, episodes: [], draft: { title: '회차', body: '초안', revision: 0 }, creationType: 'ORIGINAL', genres: ['판타지'], hashtags: [] }
  // 작품 관리는 Content 서버를 읽는다: 내 작품 목록만 주고 나머지(표지 없음·빈 회차)는 비어 있는 서버를 흉내 낸다.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith('/csrf')) return Response.json({ csrfToken: 'csrf' })
    if (path.includes('/auth/')) return Response.json({ accessToken: 'bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'Writer', operator: false } })
    if ((init?.method ?? 'GET') === 'GET' && path === '/api/v1/works') return Response.json([owned])
    if (/\/episodes$/.test(path)) return Response.json([])
    return new Response(null, { status: 404 })
  }))
  await login('writer@example.invalid', 'test-password') // Content 서버는 로그인한 요청만 받는다
  renderAt('/content?work=w', true)
  const first = await screen.findByRole('dialog', { name: '세계관 연결' }, { timeout: 5000 })
  expect(first.querySelector('.tour-count')?.textContent).toBe('1 / 3')
  for (const [step, title] of [[2, '이야기 분기'], [3, '집필 방식']] as const) {
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: title }).querySelector('.tour-count')?.textContent).toBe(`${step} / 3`))
  }
  fireEvent.click(screen.getByRole('button', { name: '완료' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(isTourSeen('manage')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '사용법' }))
  await screen.findByRole('dialog', { name: '세계관 연결' })
}, 20000)
