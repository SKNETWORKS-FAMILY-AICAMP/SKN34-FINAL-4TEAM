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
import { createAppStore } from '../../app/store'
import { forgetSession, login } from '../../data/api/auth'
import { FORK_WORLD_REQUIRED } from '../../domain/entities/work'
import { isTourSeen, tourOffKey } from '../../presentation/shared/tour/tourPrefs'

// fixtureApp은 앱 전체를 그리는 테스트가 투어에 가려지지 않게 모든 투어를 끈 채(storyfork.tour=off) 시작한다. 이 파일은 그 스위치를 켜서 앱의 자동 시작을 검사한다.
/** 스위치를 켜고, 앞 테스트가 남긴 '본 것' 기억(storyfork.tour.*)도 지워 처음 방문 상태로 만든다. */
const toursOn = () => {
  Object.keys(localStorage).filter((k) => k.startsWith(`${tourOffKey}.`)).forEach((k) => localStorage.removeItem(k))
  localStorage.removeItem(tourOffKey)
}
const toursOff = () => localStorage.setItem(tourOffKey, 'off')
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); forgetSession(); toursOff() })

it('fixtureApp은 모든 화면·탭의 투어를 끈 채 시작한다', () => {
  expect(isTourSeen('studio')).toBe(true)
  expect(isTourSeen('manage', 'settings')).toBe(true)
})

it('작품 관리는 앱에서 처음 열면 메뉴 소개(9단계)가 저절로 뜨고 이야기 분기 단계가 세계관 조건을 알리며, 끝내면 개요 탭 투어가 이어진다(#971)', async () => {
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
  // 실제 앱처럼 StrictMode로 그린다: 자동 시작 effect가 곧바로 두 번 돌아도 메뉴 소개가 탭 투어에 덮이지 않아야 한다.
  render(<StrictMode><Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={['/content?work=w']}><App /></MemoryRouter></Provider></StrictMode>)
  const intro = await screen.findByRole('dialog', { name: '개요' }, { timeout: 5000 })
  expect(intro.querySelector('.tour-count')?.textContent).toBe('1 / 9')
  const titles = ['공개 회차', '세계관·설정집', '이야기 분기', 'AI 집필', '받은 피드백', '내 제보·수정 제안', '운영 설정', '저장·AI·발행 이력']
  for (const [i, title] of titles.entries()) {
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: title }).querySelector('.tour-count')?.textContent).toBe(`${i + 2} / 9`))
    if (title === '이야기 분기') expect(screen.getByRole('dialog').textContent).toContain(FORK_WORLD_REQUIRED)
  }
  expect(screen.getByRole('dialog').textContent).toContain('다른 탭도 처음 열면 안내가 나오고, 사용법 버튼으로 다시 볼 수 있어요')
  fireEvent.click(screen.getByRole('button', { name: '완료' }))
  const tab = await screen.findByRole('dialog', { name: 'AI로 표지 만들기' })
  expect(tab.querySelector('.tour-count')?.textContent).toBe('1 / 2')
  expect(isTourSeen('manage')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(isTourSeen('manage', 'overview')).toBe(true)
}, 20000)
