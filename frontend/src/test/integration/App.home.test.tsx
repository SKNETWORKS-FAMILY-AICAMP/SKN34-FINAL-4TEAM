// @vitest-environment jsdom
import '../fixtureApp'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import { openPolicy } from '../../presentation/shared/events'
import { renderApp as renderAt } from '../renderApp'
import { stubWorkSearch } from '../stubWorkSearch'

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete document.documentElement.dataset.theme })

describe('홈·공통 셸 (U01·U02)', () => {
  it('목업 홈의 GNB·캐러셀·섹션·푸터를 보여 준다', async () => {
    vi.spyOn(appContainer.resolve('notificationRepository'), 'unreadCount').mockResolvedValue(2)
    renderAt('/')
    expect(screen.getByRole('link', { name: 'STORYFORK 홈으로' }).getAttribute('href')).toBe('/')
    await screen.findByRole('link', { name: '알림함, 읽지 않은 알림 2건' })
    await screen.findByText('다르게 이어진 포크 소설')
    for (const h of ['24시간 인기 급상승', '방금 업데이트', '소설 모아 보기', '오늘, 스토리포크의 발견', '이번 주 인기 무료 소설']) screen.getByText(h)
    expect(screen.getByText('1 / 4')).toBeTruthy()
    // 비회원은 서버 독서 기록이 없어 이어 읽기 카드가 없다(회원 홈은 아래 테스트).
    expect(screen.queryByRole('link', { name: /이어 읽기/ })).toBeNull()
    expect([...document.querySelectorAll('#home .cont, #home .rings, #home .hero, #home .t10')].map((el) => el.className)).toEqual(['rings', 'hero', 't10'])
    expect(screen.getByRole('heading', { level: 1, name: 'STORYFORK' })).toBeTruthy()
    expect(document.querySelector('#home h4')).toBeNull()
    expect(within(screen.getByLabelText('실시간 인기 TOP10')).getByRole('link', { name: '더보기 ›' }).getAttribute('href')).toBe('/rank')
    expect(within(screen.getByLabelText('실시간 인기 TOP10')).getAllByRole('listitem')).toHaveLength(10)
    within(screen.getByLabelText('실시간 인기 TOP10')).getByText('14:07 기준')
    expect(document.getElementById('sid')!.textContent).toBe('U01 홈')
    const footer = within(screen.getByRole('contentinfo'))
    expect(footer.getByText('SKN34 최종 프로젝트 4팀')).toBeTruthy()
    expect(footer.queryByRole('button', { name: '데모 초기화' })).toBeNull()
    expect(footer.queryByRole('link', { name: '로그인' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '로그인·회원가입 메뉴' }))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: '로그인' })).toBeTruthy()
  })

  it('회원 홈은 독서 기록의 이어 읽기 카드를 맨 앞에 보여 준다', async () => {
    renderAt('/', createAppStore({ role: 'user' }))
    await screen.findByRole('link', { name: /2화 이어 읽기/ })
    expect([...document.querySelectorAll('#home .cont, #home .rings, #home .hero, #home .t10')].map((el) => el.className)).toEqual(['cont', 'rings', 'hero', 't10'])
  })

  it('세계관·크레딧 메뉴의 데모 꼬리표만 없애고 정책의 실제 차감 없음 안내는 유지한다', async () => {
    renderAt('/')
    const worlds = within(screen.getByRole('navigation', { name: '주요 메뉴' })).getByRole('link', { name: /세계관/ })
    expect(worlds.getAttribute('href')).toBe('/worlds')
    expect(worlds.querySelector('.lf')?.textContent).toBe('세계관')
    expect(worlds.querySelector('.ls')?.textContent).toBe('세계관')
    expect(worlds.textContent).not.toContain('데모')
    expect(within(document.querySelector<HTMLElement>('.gnb')!).queryByRole('button', { name: /크레딧/ })).toBeNull()
    act(() => { openPolicy() })
    const policy = await screen.findByRole('dialog', { name: '크레딧·이용 정책 안내' })
    expect(policy.textContent).toContain('실제 결제나 차감은 없습니다.')
  })

  it('칩을 고르면 필터 결과(U02)를 보여 주고 안내를 닫을 수 있다', async () => {
    stubWorkSearch()
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
