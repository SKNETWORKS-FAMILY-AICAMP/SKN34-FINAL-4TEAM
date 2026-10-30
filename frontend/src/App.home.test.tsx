// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderApp as renderAt } from './test/renderApp'

afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

describe('홈·공통 셸 (U01·U02)', () => {
  it('목업 홈의 GNB·캐러셀·섹션·푸터를 보여 준다', async () => {
    renderAt('/')
    expect(screen.getByRole('button', { name: 'STORYFORK 홈으로' })).toBeTruthy()
    await screen.findByRole('button', { name: '알림함, 읽지 않은 알림 2건' })
    await screen.findByText('방금 올라온 포크 소설')
    for (const h of ['24시간 인기 급상승', '방금 업데이트', '에디터 Pick', '오늘, 스토리포크의 발견', '이번 주 인기 무료 소설']) screen.getByText(h)
    expect(screen.getByText('1 / 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: /2화 이어 읽기/ })).toBeTruthy()
    expect(within(screen.getByLabelText('실시간 인기 TOP10')).getAllByRole('listitem')).toHaveLength(10)
    expect(document.getElementById('sid')!.textContent).toBe('U01 홈')
    screen.getByRole('button', { name: '데모 초기화' })
  })

  it('칩을 고르면 필터 결과(U02)를 보여 주고 안내를 닫을 수 있다', async () => {
    renderAt('/')
    await screen.findByText('방금 올라온 포크 소설')
    fireEvent.click(screen.getByRole('button', { name: '🛰 SF' }))
    await screen.findByText('3편')
    expect(screen.getByRole('heading', { name: '🛰 SF' })).toBeTruthy()
    await waitFor(() => expect(document.getElementById('sid')!.textContent).toBe('U02 홈 · 필터 결과'))
    fireEvent.click(screen.getByRole('button', { name: '안내 닫기' }))
    expect(screen.queryByText('처음 오셨나요?')).toBeNull()
  })

  it('테마·화면 ID 토글이 동작한다', async () => {
    renderAt('/')
    await screen.findByText('방금 올라온 포크 소설')
    fireEvent.click(screen.getAllByRole('button', { name: '다크 모드로' })[0])
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getAllByRole('button', { name: '라이트 모드로' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('status').textContent).toBe('다크 모드로 바꿨어요')
    fireEvent.click(screen.getByRole('button', { name: '화면 ID 끄기' }))
    expect(document.getElementById('sid')!.hidden).toBe(true)
  })
})
