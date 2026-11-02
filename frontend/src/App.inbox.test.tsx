// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from './App'
import { appContainer } from './app/appContainer'
import { createAppStore } from './app/store'

afterEach(cleanup)

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const sid = () => document.getElementById('sid')!.textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const feedback = () => appContainer.resolve('feedbackRepository')
const item = (id: string, patch: object) => ({ id, rid: 'r-' + id, w: 'starlight', n: 1, pi: 0, type: '질문', who: '독자', text: '제보 ' + id, baseText: '', status: '작가 검토 대기', ai: { cls: '제안', why: '안내', ev: '문장' }, ...patch })

describe('알림함 (U42)', () => {
  it('필수 알림·90일 보관 안내를 보여 주고, 모두 읽음이면 GNB 배지가 사라진다', async () => {
    renderAt('/notifications')
    await screen.findByRole('heading', { name: '알림함' })
    expect(sid()).toContain('U42')
    screen.getByText(/결과·크레딧·권리·보안 알림은 필수 알림이에요\. 알림은 앱 안에서만 확인할 수 있고 90일 보관해요\./)
    screen.getByLabelText('작가 소식')
    await screen.findByRole('button', { name: /^알림함, 읽지 않은 알림 \d+건$/ })
    fireEvent.click(screen.getByRole('button', { name: '모두 읽음' }))
    await screen.findByRole('button', { name: '알림함' })
    expect(screen.getByRole('button', { name: '모두 읽음' })).toHaveProperty('disabled', true)
  })

  it('알림을 누르면 대상 화면으로 간다', async () => {
    renderAt('/notifications')
    fireEvent.click(await screen.findByRole('button', { name: /읽던 회차가 있어요/ }))
    await waitFor(() => expect(where()).toBe('/work/guunmong'))
  })
})

describe('독자 피드백함 (U20)', () => {
  it('답변을 보내면 처리 완료가 되고 서재 배지와 독자 기록이 바뀐다', async () => {
    await feedback().addReport({ id: 'r-a', w: 'starlight', n: 1, type: '질문', text: '제보 a', status: '작가 검토 대기', reply: '' })
    await feedback().addInbox(item('a', {}))
    renderAt('/inbox')
    await screen.findByRole('heading', { name: /독자 피드백함/ })
    expect(sid()).toContain('U20')
    await screen.findByRole('button', { name: '내 서재, 처리할 독자 제보 1건' })
    fireEvent.change(screen.getByLabelText('작가 답변'), { target: { value: '의도한 복선이에요' } })
    fireEvent.click(screen.getByRole('button', { name: '답변 보내기' }))
    await toastIs('처리했어요 (데모)')
    await waitFor(() => expect(screen.queryByRole('button', { name: /처리할 독자 제보/ })).toBeNull())
    cleanup()
    renderAt('/lib?tab=qa')
    const rep = await screen.findByText('🤖 작가 답변: 의도한 복선이에요')
    within(rep.closest('.rp') as HTMLElement).getByText('처리 완료')
  })

  it('수정 제안은 승인한 뒤 따로 발행해야 원고가 바뀐다', async () => {
    const works = await appContainer.resolve('workRepository').listWorks()
    const text = works.find((w) => w.id === 'starlight')!.eps[0].p[0]
    const from = text.slice(0, 4)
    await feedback().addInbox(item('b', { type: '단순 오류', status: '수정 제안', from, to: '바뀐말', baseText: text }))
    renderAt('/inbox?i=b')
    fireEvent.click(await screen.findByRole('button', { name: '수정안 승인' }))
    await toastIs('수정안을 승인했어요. 발행은 별도로 확인해 주세요')
    fireEvent.click(await screen.findByRole('button', { name: '수정안 발행' }))
    await toastIs('수정안을 발행했어요 (데모)')
    const after = (await appContainer.resolve('workRepository').listWorks()).find((w) => w.id === 'starlight')!.eps[0].p[0]
    expect(after).toBe(text.replace(from, '바뀐말'))
  })
})

describe('권리 신고 소명 (data-appeal-form)', () => {
  it('비공개 조치된 내 작품에 소명을 제출한다', async () => {
    await feedback().addReview({ id: 'q1', w: 'starlight', n: null, type: '권리 침해', text: '무단 사용 의심', quote: '', status: '비공개 조치', who: '신고자' })
    renderAt('/lib?tab=write')
    const form = await screen.findByRole('form', { name: '별빛 서약의 탑 · 권리 신고 소명' })
    fireEvent.change(within(form).getByLabelText('소명 내용'), { target: { value: '   ' } })
    fireEvent.click(within(form).getByRole('button', { name: '소명 제출' }))
    await toastIs('소명 내용을 입력해 주세요')
    fireEvent.change(within(form).getByLabelText('소명 내용'), { target: { value: '직접 쓴 원고예요' } })
    fireEvent.click(within(form).getByRole('button', { name: '소명 제출' }))
    await toastIs('소명을 제출했어요 (데모)')
    await waitFor(() => expect(screen.queryByRole('form', { name: '별빛 서약의 탑 · 권리 신고 소명' })).toBeNull())
  })
})

describe('캐릭터 챗 (U27)', () => {
  it('목록에서 인물을 골라 읽은 회차까지만 대답한다', async () => {
    renderAt('/chat')
    await screen.findByRole('heading', { name: '캐릭터챗' })
    expect(sid()).toContain('U27')
    fireEvent.click(within(screen.getByRole('navigation', { name: '작품 유형' })).getByRole('button', { name: '포크' }))
    await waitFor(() => expect(where()).toContain('kind=fork'))
    fireEvent.click(within(screen.getByRole('navigation', { name: '작품 유형' })).getByRole('button', { name: '전체' }))
    fireEvent.click(await screen.findByRole('button', { name: /^성진 .*구운몽/ }))
    await waitFor(() => expect(where()).toBe('/chat/guunmong/%EC%84%B1%EC%A7%84'))
    await screen.findByText('소승 성진이라 합니다. 무엇이 궁금하십니까?')
    fireEvent.click(screen.getByRole('button', { name: '용궁에서 왜 술을 마셨어요?' }))
    await screen.findByText('근거 · 1화')
    fireEvent.click(screen.getByRole('button', { name: '🔒 스승님께 벌을 받고 어떤 마음이었어요?' }))
    await screen.findByText('그건 아직 말할 수 없어요. 3화를 읽고 다시 물어봐 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await toastIs('물어볼 내용을 입력해 주세요')
    screen.getByRole('button', { name: /2화에서 포크하기/ })
  })
})
