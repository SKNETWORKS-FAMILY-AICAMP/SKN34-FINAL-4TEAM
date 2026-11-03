// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderApp } from './test/renderApp'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('uses server authorization on persisted studio routes without a demo session',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'서버 인증이 필요합니다.'}),{status:401})))
  renderApp('/studio/00000000-0000-0000-0000-000000000001')
  expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('서버 인증이 필요합니다.'))
  expect(screen.queryByRole('button',{name:'데모 계정으로 바로 시작'})).toBeNull()
})
