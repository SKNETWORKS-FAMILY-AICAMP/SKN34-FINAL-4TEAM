// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../app/appContainer'
import { ReportWorkForm } from './ReportWorkForm'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('신고 사유를 비워 보내면 브라우저 말풍선 대신 화면의 경고로 알리고 서버에 보내지 않는다', async () => {
  const sent = vi.spyOn(appContainer.resolve('reportRepository'), 'submit')
  render(<MemoryRouter><ReportWorkForm workId="w1" workTitle="달빛 도서관" alwaysOpen /></MemoryRouter>)
  expect(screen.getByLabelText<HTMLTextAreaElement>('신고 사유').required).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '신고 접수' }))
  expect((await screen.findByRole('alert')).textContent).toBe('신고 사유는 1~2000자로 입력해 주세요.')
  expect(sent).not.toHaveBeenCalled()
})
