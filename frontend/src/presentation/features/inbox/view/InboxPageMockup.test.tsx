// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { InboxPage } from './InboxPage'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** 독자 오타 제보를 실제 접수 흐름(FeedbackUseCase)으로 만들고 그 항목을 선택한 피드백함을 연다. */
async function openTypoReport(paragraph: string) {
  const works = appContainer.resolve('workRepository')
  const star = (await works.listWorks()).find((w) => w.id === 'starlight')!
  star.eps[0].p[0] = paragraph
  await works.saveWork(star)
  await appContainer.resolve('feedbackUseCase').sendFeedback({ workId: 'starlight', n: 1, type: '단순 오류', text: '오타예요', sentence: { t: paragraph, pi: 0 }, verified: false, nick: '독자' })
  const [item] = await appContainer.resolve('feedbackRepository').listInbox()
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[`/inbox?i=${item.id}`]}><InboxPage /></MemoryRouter></Provider>)
}

describe('독자 피드백함 수정 제안 (#32)', () => {
  it('독자 오타 제보(작가 검토 대기)에도 수정안 승인·거절 버튼이 나온다', async () => {
    await openTypoReport('그건 않 된다고 했다.')
    await screen.findByRole('button', { name: '수정안 승인' })
    screen.getByRole('button', { name: '거절' })
  })

  it('diff 미리보기는 발행처럼 첫 번째 일치 한 곳만 지금·바꾸면으로 나눠 보여 준다', async () => {
    const cur = '안 된다던 말, 않 된다던 말, 않 된다던 말'
    await openTypoReport(cur)
    await screen.findByText('수정 제안 (PR)')
    const [before, after] = [document.querySelector('.diff .o')!, document.querySelector('.diff .n')!]
    expect([...before.querySelectorAll('del')].map((x) => x.textContent)).toEqual(['않 된다'])
    expect([...after.querySelectorAll('ins')].map((x) => x.textContent)).toEqual(['안 된다'])
    expect(before.textContent).toBe('지금' + cur)
    expect(after.textContent).toBe('바꾸면' + cur.replace('않 된다', '안 된다'))
  })

  it('원문이 바뀌어 반영 실패가 된 수정 제안도 거절할 수 있다', async () => {
    await openTypoReport('그건 않 된다고 했다.')
    const works = appContainer.resolve('workRepository')
    const star = (await works.listWorks()).find((w) => w.id === 'starlight')!
    star.eps[0].p[0] = '그건 않 된다고 했다. 고쳐 썼다.'
    await works.saveWork(star)
    fireEvent.click(await screen.findByRole('button', { name: '수정안 승인' }))
    await screen.findByText('원문이 변경되어 수정안을 다시 검토해 주세요')
    fireEvent.click(await screen.findByRole('button', { name: '거절' }))
    await screen.findByText('처리했어요 (데모)')
    expect((await appContainer.resolve('feedbackRepository').listInbox())[0].status).toBe('거절됨')
  })
})
