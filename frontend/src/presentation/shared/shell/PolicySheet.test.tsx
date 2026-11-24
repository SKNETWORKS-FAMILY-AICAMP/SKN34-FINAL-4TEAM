// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { PolicySheet } from './PolicySheet'

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

/** 실제 앱 컨테이너(appContainer)로 렌더하고 '정책 안내' 버튼과 같은 sf-policy 이벤트로 연다. */
const openSheet = async () => {
  render(<Provider store={createAppStore({ role: 'user' })}><PolicySheet /></Provider>)
  await act(async () => { window.dispatchEvent(new Event('sf-policy')) })
  return screen.findByRole('heading', { name: '크레딧·이용 정책 안내' })
}

it('실제 모드에서는 목업·시연 문구와 데모 잔액을 보이지 않고 결제 내역 화면을 안내한다', async () => {
  await openSheet()
  const text = document.body.textContent ?? ''
  for (const hidden of ['목업', '시연', '데모 잔액', '다음 AI 요청 실패 시연', '30 / 5 / 5']) expect(text).not.toContain(hidden)
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(text).toContain('결제 내역')
})

it('mockup 모드에서는 기존 데모 잔액과 실패 시연 체크박스를 그대로 보인다', async () => {
  vi.stubEnv('MODE', 'mockup')
  await openSheet()
  expect(screen.getByRole('checkbox', { name: '다음 AI 요청 실패 시연' })).toBeTruthy()
  expect(await screen.findByText(/데모 잔액 100 · 사용 기록 0건/)).toBeTruthy()
  expect(screen.getByText('목업 처리')).toBeTruthy()
})
