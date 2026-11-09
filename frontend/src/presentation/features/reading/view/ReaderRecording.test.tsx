// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { renderApp } from '../../../../test/renderApp'

const records = () => appContainer.resolve('readingRecordRepository')
// 테스트 파일은 메모리 컨테이너 하나를 공유하므로 매번 이 작품의 기록을 비운다.
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await records().remove('postman') })

describe('회차 뷰어의 독서 기록', () => {
  it('회원이 회차를 열면 그 회차가 이어 읽기 위치가 되어 독서 기록에 남는다', async () => {
    renderApp('/read/postman/1', createAppStore({ role: 'user' }))
    await screen.findByRole('heading', { name: '수취인 불명' })
    await waitFor(async () => expect((await records().list())[0]).toEqual({ workId: 'postman', lastEpisode: 1, readEpisodes: [1] }))
  })

  it('기록 저장이 실패해도 회차는 그대로 열리고 실패를 알리며 저장된 것처럼 보이지 않는다', async () => {
    vi.spyOn(records(), 'record').mockRejectedValue(new Error('offline'))
    renderApp('/read/postman/1', createAppStore({ role: 'user' }))
    await screen.findByRole('heading', { name: '수취인 불명' })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('이어 읽기 위치를 저장하지 못했어요 · 읽기는 계속할 수 있어요'))
    expect((await records().list()).some((r) => r.workId === 'postman')).toBe(false)
  })

  it('기록 저장이 끝나기를 기다리지 않고 회차를 바로 보여 주며, 저장 중에는 실패도 알리지 않는다', async () => {
    vi.spyOn(records(), 'record').mockReturnValue(new Promise<void>(() => {}))
    renderApp('/read/postman/1', createAppStore({ role: 'user' }))
    await screen.findByRole('heading', { name: '수취인 불명' })
    expect(screen.queryByText(/저장하지 못했어요/)).toBeNull()
  })

  it('정본 작품의 안내는 읽은 회차가 계정에 저장되고 관심 표시만 이 창에 남는다고 말한다', async () => {
    const work = appContainer.resolve('mockDb').works.find((w) => w.id === 'postman')!
    work.canonical = true
    try {
      renderApp('/read/postman/1', createAppStore({ role: 'user' }))
      await screen.findByRole('heading', { name: '수취인 불명' })
      expect(document.querySelector('.hint')!.textContent).toBe('공개된 회차를 읽고 허용된 시점에서 포크할 수 있어요. 로그인하면 읽은 회차가 계정에 저장되고, 관심 표시는 이 창에서만 유지돼요.')
    } finally { cleanup(); delete work.canonical }
  })
})
