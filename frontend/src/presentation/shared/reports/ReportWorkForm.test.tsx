// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../app/appContainer'
import { ReportWorkForm } from './ReportWorkForm'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('신고 사유를 비워 보내면 브라우저 말풍선 대신 화면의 경고로 알리고 서버에 보내지 않는다', async () => {
  const sent = vi.spyOn(appContainer.resolve('reportRepository'), 'submit')
  render(<MemoryRouter><ReportWorkForm target={{ workId: 'w1' }} title="달빛 도서관" alwaysOpen /></MemoryRouter>)
  expect(screen.getByLabelText<HTMLTextAreaElement>('신고 사유').required).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '신고 접수' }))
  expect((await screen.findByRole('alert')).textContent).toBe('신고 사유는 1~2000자로 입력해 주세요.')
  expect(sent).not.toHaveBeenCalled()
})

it.each([
  ['회차', { targetType: 'episode' as const, workId: 'w1', episodeNumber: 3 }, '달빛 도서관 3화'],
  ['세계관', { targetType: 'world' as const, worldId: 'wd1' }, '달무리 군도'],
])('%s 신고는 대상 이름을 폼 이름에 쓰고 대상 종류와 값을 접수에 싣는다(결정 D)', async (_name, target, title) => {
  const sent = vi.spyOn(appContainer.resolve('reportRepository'), 'submit').mockResolvedValue(undefined)
  render(<MemoryRouter><ReportWorkForm target={target} title={title} alwaysOpen /></MemoryRouter>)
  expect(screen.getByRole('form', { name: `${title} 신고` })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('신고 사유'), { target: { value: '무단 사용' } })
  fireEvent.click(screen.getByRole('button', { name: '신고 접수' }))
  await screen.findByText(/신고를 접수했어요\./)
  expect(sent).toHaveBeenCalledWith({ kind: 'RIGHTS', reason: '무단 사용', evidence: '', ...target })
})
