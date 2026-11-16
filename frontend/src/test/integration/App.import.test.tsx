// @vitest-environment jsdom
import '../fixtureApp'

import { cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../scrollToSpy'
import App from '../../App'
import { createAppStore } from '../../app/store'

afterEach(() => { cleanup(); vi.unstubAllEnvs() })

const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>)

describe('/import 실제·데모 분기', () => {
  it('실제 모드는 TXT·EPUB 원고 가져오기 화면을 열고 데모 예시 원고 버튼은 없다', async () => {
    renderAt('/import')
    await screen.findByRole('heading', { name: '내 소설 가져오기' })
    expect(screen.getByLabelText('원고 파일 (.txt, .epub)')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('내 소설 가져오기')
    expect(screen.queryByRole('button', { name: /예시 소설 선택/ })).toBeNull()
    expect(screen.getByRole('link', { name: '세계관 만들기' }).getAttribute('href')).toBe('/worldstudio')
  })

  it('--mode mockup은 기존 데모 가져오기 화면을 그대로 열고 파일 업로드 칸은 없다', async () => {
    vi.stubEnv('MODE', 'mockup')
    renderAt('/import')
    expect(await screen.findByRole('button', { name: /예시 소설 선택/ })).toBeTruthy()
    expect(screen.queryByLabelText('원고 파일 (.txt, .epub)')).toBeNull()
    expect(screen.getByRole('link', { name: '새 소설 만들기에서 세계관 만들기' }).getAttribute('href')).toBe('/new')
  })
})
