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

const NOTICE = '업로드한 원고는 세계관 자동 추출을 위해 OpenAI로 전송돼요.'
const started: ImportWorldBuild = { status: 'started', jobId: 'job-1', code: null, message: null }
const rejected: ImportWorldBuild = { status: 'rejected', jobId: null, code: 'PREPROCESSING_LOAD_REVIEW_REQUIRED', message: '이전 작업의 적재 여부를 먼저 확인해 주세요.' }
const show = (extra: Record<string, unknown> = {}) => {
  hook.vm = {
    basis: { lastNumber: 2, workRevision: 5 }, rows: [], start: '3', setStart: vi.fn(), rightsConfirmed: false, setRightsConfirmed: vi.fn(),
    editable: true, busy: false, error: '', stopReason: null, progress: null, results: new Map(), savedCount: 0, failedCount: 0, worldBuild: null,
    canStart: false, canRetry: false, selectFiles: vi.fn(), move: vi.fn(), replaceFailed: vi.fn(), refreshBasis: vi.fn(), submit: vi.fn(), retryFailed: vi.fn(),
    ...extra,
  }
  return render(<Provider store={createAppStore()}><MemoryRouter><EpisodeBulkImportSheet workId="w" onClose={vi.fn()} /></MemoryRouter></Provider>)
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

it('세계관 추출이 거절되면 서버가 준 사유를 시트 안 알림(role=alert)으로 남긴다', () => {
  show({ editable: false, savedCount: 1, worldBuild: rejected })
  expect(screen.getByRole('alert').textContent).toBe(rejected.message)
})

it('접수하지 않았으면(null) 세계관 추출 문구를 그리지 않는다', () => {
  show({ editable: false, savedCount: 1, worldBuild: null })
  expect(screen.queryByText(/세계관 추출을 시작/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
