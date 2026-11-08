// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from './app/appContainer'
import { renderApp as renderAt } from './test/renderApp'

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete document.documentElement.dataset.theme })

describe('홈·공통 셸 (U01·U02)', () => {
  it('목업 홈의 GNB·캐러셀·섹션·푸터를 보여 준다', async () => {
    vi.spyOn(appContainer.resolve('notificationRepository'), 'unreadCount').mockResolvedValue(2)
    renderAt('/')
    expect(screen.getByRole('link', { name: 'STORYFORK 홈으로' }).getAttribute('href')).toBe('/')
    await screen.findByRole('link', { name: '알림함, 읽지 않은 알림 2건' })
    await screen.findByText('다르게 이어진 포크 소설')
    for (const h of ['이야기의 시작, 원작 소설', '함께 읽을 소설', '소설 모아 보기', '오늘, 스토리포크의 발견', '원작부터 읽어 보세요']) screen.getByText(h)
    expect(screen.getByText('1 / 4')).toBeTruthy()
    expect(screen.getByRole('link', { name: /2화 이어 읽기/ })).toBeTruthy()
    expect([...document.querySelectorAll('#home .cont, #home .rings, #home .hero, #home .t10')].map((el) => el.className)).toEqual(['cont', 'rings', 'hero', 't10'])
    expect(screen.getByRole('heading', { level: 1, name: 'STORYFORK' })).toBeTruthy()
    expect(document.querySelector('#home h4')).toBeNull()
    expect(within(screen.getByLabelText('공개 소설 목록')).getByRole('link', { name: '더보기 ›' }).getAttribute('href')).toBe('/rank')
    expect(within(screen.getByLabelText('공개 소설 목록')).getAllByRole('listitem')).toHaveLength(10)
    expect(document.getElementById('sid')!.textContent).toBe('U01 홈')
    const footer = within(screen.getByRole('contentinfo'))
    expect(footer.getByText('SKN34 최종 프로젝트 4팀 · 인터랙티브 MVP (오프라인 · AI 응답은 미리 정한 데모)')).toBeTruthy()
    expect(footer.queryByRole('button', { name: '데모 초기화' })).toBeNull()
    expect(footer.queryByRole('link', { name: '로그인' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '로그인·회원가입 메뉴' }))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: '로그인' })).toBeTruthy()
  })

  it('칩을 고르면 필터 결과(U02)를 보여 주고 안내를 닫을 수 있다', async () => {
    renderAt('/')
    await screen.findByText('다르게 이어진 포크 소설')
    expect(screen.getByRole('button', { name: '추천' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '🛰 SF' }))
    await screen.findByText('3편')
    expect(screen.getByRole('button', { name: '🛰 SF' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '추천' }).getAttribute('aria-pressed')).toBe('false')
    for (const id of ['reply', 'postif']) {
      const card = document.querySelector(`#home .grid6 a[href="/work/${id}"]`)!
      expect(card.querySelector('.fork-source')?.textContent).toMatch(/회색 도시의 우편배달부 · \d+화에서 분기/)
    }
    expect(screen.getByRole('heading', { name: '🛰 SF' })).toBeTruthy()
    await waitFor(() => expect(document.getElementById('sid')!.textContent).toBe('U02 홈 · 필터 결과'))
    fireEvent.click(screen.getByRole('button', { name: '안내 닫기' }))
    expect(screen.queryByText('처음 오셨나요?')).toBeNull()
  })

  it('테마·화면 ID 토글이 동작한다', async () => {
    renderAt('/')
    await screen.findByText('다르게 이어진 포크 소설')
    fireEvent.click(screen.getAllByRole('button', { name: '다크 모드로' })[0])
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getAllByRole('button', { name: '라이트 모드로' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('status').textContent).toBe('다크 모드로 바꿨어요')
    fireEvent.click(screen.getByRole('button', { name: '화면 ID 끄기' }))
    expect(document.getElementById('sid')!.hidden).toBe(true)
  })
})
