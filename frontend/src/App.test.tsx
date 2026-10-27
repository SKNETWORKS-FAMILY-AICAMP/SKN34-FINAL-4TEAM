// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

function response(service: string) {
  return new Response(JSON.stringify({ status: 'up', service }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('STORYFORK foundation', () => {
  it('shows the actual Core and AI health using only public Core endpoints', async () => {
    const fetchMock = vi.fn(async (url: string) => response(
      url.endsWith('/ai-service') ? 'storyfork-ai-service' : 'storyfork-core-api',
    ))
    vi.stubGlobal('fetch', fetchMock)
    renderApp()
    expect(screen.getByRole('heading', { name: 'STORYFORK' })).toBeTruthy()
    expect(screen.getByText('개발 기반 / 기능 준비 중')).toBeTruthy()
    expect(screen.getByText('Core API 연결 확인 중')).toBeTruthy()
    await screen.findByText('Core API 연결됨')
    await screen.findByText('AI Service (Core 경유) 연결됨')
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/v1/health', '/api/v1/health/ai-service',
    ])
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps Core healthy when AI fails, hides private errors and retries AI', async () => {
    let aiCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.endsWith('/ai-service')) return response('storyfork-core-api')
      aiCalls += 1
      if (aiCalls === 1) throw new Error('private upstream detail')
      return response('storyfork-ai-service')
    }))
    renderApp()
    await screen.findByText('AI Service (Core 경유) 연결 실패')
    expect(screen.getByText('Core API 연결됨')).toBeTruthy()
    expect(screen.queryByText('private upstream detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'AI Service (Core 경유) 다시 확인' }))
    await screen.findByText('AI Service (Core 경유) 연결됨')
    expect(aiCalls).toBe(2)
  })

  it('redirects unknown routes to the safe start page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(
      url.endsWith('/ai-service') ? 'storyfork-ai-service' : 'storyfork-core-api',
    )))
    renderApp('/unknown')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'STORYFORK' })).toBeTruthy())
    await screen.findByText('Core API 연결됨')
  })
})
