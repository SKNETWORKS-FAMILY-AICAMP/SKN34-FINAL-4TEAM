// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp as renderAt } from './test/renderApp'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderApp = (path = '/status') => renderAt(path)

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

  it('keeps the health check at /status and mounts React from the Vite entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(
      url.endsWith('/ai-service') ? 'storyfork-ai-service' : 'storyfork-core-api',
    )))
    renderApp('/status')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'STORYFORK' })).toBeTruthy())
    await screen.findByText('Core API 연결됨')
    const entry = readFileSync(`${process.cwd()}/index.html`, 'utf8')
    expect(entry).toContain('<div id="root"></div>')
    expect(entry).toContain('src="/src/main.tsx"')
  })
})
