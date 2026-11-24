// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { ImportWorldBuild } from '../../../../domain/entities/manuscript'

// 시트는 ViewModel이 돌려준 상태만 그린다. 저장·접수 흐름은 useEpisodeBulkImport.test가 맡는다.
const hook = vi.hoisted(() => ({ vm: {} as Record<string, unknown> }))
vi.mock('../viewmodel/useEpisodeBulkImport', () => ({ useEpisodeBulkImport: () => hook.vm }))

import { EpisodeBulkImportSheet } from './EpisodeBulkImportSheet'

const NOTICE = '세계관을 처음 만들 때는 업로드한 원고가 자동 추출을 위해 OpenAI로 전송돼요.'
const started: ImportWorldBuild = { status: 'started', jobId: 'job-1', code: null, message: null }
const rejected: ImportWorldBuild = { status: 'rejected', jobId: null, code: null, message: '1화에 저장한 원고가 없어요. 모든 회차의 원고를 저장한 뒤 다시 시작해 주세요.' }
const show = (extra: Record<string, unknown> = {}, firstEpisodeUnsaved = false) => {
  hook.vm = {
    basis: { lastNumber: 2, workRevision: 5 }, rows: [], start: '3', setStart: vi.fn(), rightsConfirmed: false, setRightsConfirmed: vi.fn(),
    editable: true, busy: false, error: '', stopReason: null, progress: null, results: new Map(), savedCount: 0, failedCount: 0, worldBuild: null,
    canStart: false, canRetry: false, selectFiles: vi.fn(), move: vi.fn(), replaceFailed: vi.fn(), refreshBasis: vi.fn(), submit: vi.fn(), retryFailed: vi.fn(),
    ...extra,
  }
  return render(<Provider store={createAppStore()}><MemoryRouter><EpisodeBulkImportSheet workId="w" firstEpisodeUnsaved={firstEpisodeUnsaved} onClose={vi.fn()} /></MemoryRouter></Provider>)
}
afterEach(cleanup)

it('회차 저장 버튼 곁에 OpenAI 전송 안내 한 줄을 두고 확인 입력은 권리 확인 하나뿐이다', () => {
  show({ canStart: true, rightsConfirmed: true })
  const footer = screen.getByText(NOTICE).closest('footer')!
  expect(within(footer).getByRole('button', { name: '회차 저장' })).toBeTruthy()
  expect(within(footer).getAllByRole('checkbox')).toHaveLength(1)
})

it('세계관 추출이 시작되면 진행을 볼 곳을 상태 문구(role=status)로 알린다', () => {
  show({ editable: false, savedCount: 2, worldBuild: started })
  expect(screen.getByText('세계관 추출을 시작했어요. 작품 관리 > 세계관에서 진행을 볼 수 있어요.').getAttribute('role')).toBe('status')
})

it('회차 저장 집계와 세계관 추출 거절 사유를 함께 표시한다', () => {
  show({ editable: false, progress: { done: 2, total: 2 }, savedCount: 2, worldBuild: rejected })
  expect(screen.getByRole('status').textContent).toContain('저장 2개 · 실패 0개')
  expect(screen.getByRole('alert').textContent).toBe(`세계관 추출을 시작하지 못했어요. ${rejected.message}`)
})

it.each([
  { firstEpisodeUnsaved: true, number: 2, shown: true },
  { firstEpisodeUnsaved: true, number: 1, shown: false },
  { firstEpisodeUnsaved: true, number: 0, shown: false },
  { firstEpisodeUnsaved: false, number: 2, shown: false },
])('파일 대상이 1화를 건너뛸 때 저장본이 없으면 사전 안내를 표시한다 (%j)', ({ firstEpisodeUnsaved, number, shown }) => {
  show({
    rows: [{ id: 0, file: new File(['원고'], '첫 파일.txt'), number, title: '첫 파일' }],
    start: String(number), canStart: number > 0,
  }, firstEpisodeUnsaved)
  const notice = screen.queryByText(/1화에 저장한 원고가 없어서/)
  expect(!!notice).toBe(shown)
  if (shown) {
    const start = screen.getByRole('spinbutton', { name: '시작 회차' })
    expect(start.getAttribute('aria-describedby')).toBe(notice!.id)
    expect((screen.getByRole('button', { name: '회차 저장' }) as HTMLButtonElement).disabled).toBe(false)
  }
})

it('접수하지 않았으면(null) 세계관 추출 문구를 그리지 않는다', () => {
  show({ editable: false, savedCount: 1, worldBuild: null })
  expect(screen.queryByText(/세계관 추출을 시작/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('최초 구축이 끝난 작품은 발행 안내를 상태 메시지로 보여 준다', () => {
  const message = '새 회차를 처음 발행하면 세계관 초안에 반영돼요.'
  show({ editable: false, savedCount: 1, worldBuild: { ...rejected, code: 'WORLD_UPDATE_ON_PUBLISH', message } })
  expect(screen.getByRole('status').textContent).toBe(message)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText(NOTICE)).toBeNull()
})
