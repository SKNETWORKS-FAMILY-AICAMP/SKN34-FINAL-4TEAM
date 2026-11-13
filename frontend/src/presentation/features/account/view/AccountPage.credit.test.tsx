// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import '../../../../test/testLocks'

import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { sessionActions } from '../../../shared/session/sessionSlice'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const me = { id: '1', nickname: '읽는사람', email: 'reader@storyfork.demo', operator: false }
const balance = { total: 40, items: [{ kind: 'reward', remaining: 10, expiresAt: '2026-11-30T15:00:00Z' }, { kind: 'signup-trial', remaining: 30, expiresAt: '2026-12-10T01:00:00Z' }] }
const history = { items: [{ type: 'spend', kind: 'reward', amount: 5, occurredAt: '2026-11-10T01:00:00Z' }, { type: 'grant', kind: 'signup-trial', amount: 30, occurredAt: '2026-11-10T00:00:00Z' }, { type: 'expire', kind: 'event', amount: 7, occurredAt: '2026-11-01T00:00:00Z' }] }

/** 로그인한 사용자로 결제 내역을 연다. `credits`로 잔액 응답을 정한다. */
function setup(credits: () => Response | Promise<Response>, historyBody: unknown = history) {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/csrf')) return Response.json({ csrfToken: 'c' })
    if (url.endsWith('/refresh')) return Response.json({ accessToken: 'token', user: me })
    if (url.endsWith('/api/v1/me/credits')) return credits()
    if (url.endsWith('/api/v1/me/credits/history')) return Response.json(historyBody)
    return Response.json(me)
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, ...renderApp('/me/pay', createAppStore({ role: 'user' })) }
}

/** '보유 크레딧' 칸의 큰 숫자. 화면의 다른 숫자와 겹치지 않도록 이 칸 안에서만 읽는다. */
const heldCredits = async () => (await screen.findByText('보유 크레딧')).parentElement!.querySelector('b')!.textContent

describe('결제 내역 (U33)', () => {
  it('Core 크레딧 API의 보유 크레딧·가장 빠른 소멸 예정·지급·사용·소멸 내역을 보여 준다', async () => {
    setup(() => Response.json(balance))
    expect(await heldCredits()).toBe('40')
    expect(screen.getByText('보상 크레딧 10')).toBeTruthy()
    expect(screen.getByText('사용 · 보상 크레딧')).toBeTruthy()
    expect(screen.getByText('지급 · 가입 체험 크레딧')).toBeTruthy()
    expect(screen.getByText('소멸 · 이벤트 크레딧')).toBeTruthy()
    expect(screen.getByText('+30')).toBeTruthy()
    expect(screen.getByText('-5')).toBeTruthy()
    expect(screen.getByText('-7')).toBeTruthy()
  })

  it('같은 시각에 소멸하는 두 종류 크레딧은 합계로 보여 준다', async () => {
    const expiresAt = '2026-11-30T15:00:00Z'
    setup(() => Response.json({ total: 45, items: [{ kind: 'signup-trial', remaining: 30, expiresAt }, { kind: 'reward', remaining: 10, expiresAt }, { kind: 'event', remaining: 5, expiresAt: '2026-12-31T15:00:00Z' }] }))
    expect(await heldCredits()).toBe('45')
    expect(screen.getByText('가입 체험 크레딧·보상 크레딧 40')).toBeTruthy()
  })

  it('다시 읽기에 실패하면 기존 내역이 있어도 실패를 알린다', async () => {
    let fail = false
    const { store } = setup(() => fail ? new Response(null, { status: 500 }) : Response.json(balance))
    expect(await heldCredits()).toBe('40')
    fail = true
    act(() => { store.dispatch(sessionActions.dataChanged()) })
    expect((await screen.findByRole('alert')).textContent).toContain('크레딧을 불러오지 못했어요')
    expect(screen.getByText('보유 크레딧')).toBeTruthy()
  })

  it('지급받은 크레딧이 없으면 0과 빈 내역을 그대로 알린다', async () => {
    setup(() => Response.json({ total: 0, items: [] }), { items: [] })
    expect(await heldCredits()).toBe('0')
    expect(screen.getByText('소멸 예정인 크레딧이 없어요')).toBeTruthy()
    expect(screen.getByText('지급·사용 내역이 없어요.')).toBeTruthy()
  })

  it('정책 안내 버튼을 누르면 크레딧·이용 정책 안내 시트가 열린다', async () => {
    setup(() => Response.json(balance))
    await heldCredits()
    fireEvent.click(screen.getByRole('button', { name: '정책 안내' }))
    const policy = await screen.findByRole('dialog', { name: '크레딧·이용 정책 안내' })
    expect(policy.textContent).toContain('실제 결제나 차감은 없습니다.')
  })

  it('불러오지 못하면 숨기지 않고 알린 뒤 다시 불러올 수 있다', async () => {
    let fail = true
    setup(() => fail ? new Response(null, { status: 500 }) : Response.json(balance))
    expect((await screen.findByRole('alert')).textContent).toContain('크레딧을 불러오지 못했어요')
    expect(screen.queryByText('보유 크레딧')).toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await heldCredits()).toBe('40')
  })
})
