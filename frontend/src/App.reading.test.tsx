// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { appContainer } from './app/appContainer'
import { createAppStore } from './app/store'
import { renderApp } from './test/renderApp'

afterEach(cleanup)

const user = () => createAppStore({ role: 'user' })
const sid = () => document.getElementById('sid')!.textContent
const sentence = async (t: string) => (await screen.findAllByText(t)).find((el) => el.classList.contains('s'))!

describe('소설 상세 (U04)', () => {
  it('없는 작품은 목업 unavailableWork 화면을 보여 준다', async () => {
    renderApp('/work/nope')
    await screen.findByRole('heading', { name: '소설을 찾을 수 없거나 볼 수 없어요.' })
    screen.getByRole('button', { name: '홈으로' })
  })

  it('회차 검색·결과 없음·정렬·좋아요·포크 허용 회차를 보여 준다', async () => {
    renderApp('/work/guunmong')
    await screen.findByRole('heading', { name: '구운몽' })
    expect(sid()).toBe('U04 소설 상세')
    screen.getByText('전체 4화')
    expect(screen.getByText('2·3·4화').closest('p')!.textContent).toContain('운영팀이 2·3·4화에서 포크를 허용했어요.')
    const list = () => [...document.querySelectorAll<HTMLElement>('#eplist .ep')].filter((el) => el.style.display !== 'none').map((el) => el.querySelector('.no')!.textContent)
    fireEvent.change(screen.getByLabelText('회차 검색'), { target: { value: '팔선녀' } })
    expect(list()).toEqual(['2'])
    fireEvent.change(screen.getByLabelText('회차 검색'), { target: { value: '없는말' } })
    screen.getByText('검색 결과가 없어요.')
    fireEvent.change(screen.getByLabelText('회차 검색'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '최신순' }))
    expect(list()).toEqual(['4', '3', '2', '1'])
    fireEvent.click(screen.getByRole('button', { name: '관심 소설' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '관심 소설' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('status').textContent).toBe('관심 소설에 담았어요')
    expect(document.getElementById('lkc')!.textContent).toBe('1.2만')
    fireEvent.click(screen.getByRole('button', { name: '공유' }))
    expect(screen.getByRole('status').textContent).toBe('링크 공유는 데모예요 (실제 복사 없음)')
    screen.getByText('🔥 인기 포크')
  })

  it('소설 신고는 소설 단위 시트로 열리고 Esc로 닫으면 포커스가 신고 버튼으로 돌아온다', async () => {
    renderApp('/work/guunmong')
    const open = await screen.findByRole('button', { name: '구운몽 소설 신고' })
    open.focus()
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: '소설 신고' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(sid()).toBe('U06 댓글·피드백·신고')
    within(dialog).getByText('문장별 신고가 아니라 소설 전체에 대한 신고예요.')
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['권리 침해', '유해 콘텐츠'])
    expect(document.activeElement).toBe(within(dialog).getByLabelText('신고 내용'))
    within(dialog).getByRole('button', { name: '신고하기' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '신고하기' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(open)
    expect(sid()).toBe('U04 소설 상세')
  })

  it('신고 내용을 적어 접수하면 운영 검토 목록에 회차 없이 남는다', async () => {
    renderApp('/work/guunmong')
    fireEvent.click(await screen.findByRole('button', { name: '구운몽 소설 신고' }))
    const dialog = screen.getByRole('dialog', { name: '소설 신고' })
    fireEvent.click(within(dialog).getByRole('button', { name: '신고하기' }))
    expect(screen.getByRole('status').textContent).toBe('신고 내용을 입력해 주세요')
    fireEvent.change(within(dialog).getByLabelText('신고 내용'), { target: { value: '권리 확인 부탁' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '신고하기' }))
    await within(dialog).findByText(/신고를 운영팀에 접수했어요/)
    expect(appContainer.resolve('mockDb').reviewQueue[0]).toMatchObject({ w: 'guunmong', n: null, type: '권리 침해' })
    fireEvent.click(within(dialog).getByRole('button', { name: '확인' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('회차 뷰어 (U05·U07·U08)', () => {
  it('비로그인으로 열면 로그인 안내 후 원래 회차로 돌아온다', async () => {
    renderApp('/read/guunmong/2')
    await screen.findByText('소설을 읽으려면 로그인해 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '데모 계정으로 바로 시작' }))
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
  })

  it('작가의 말은 본문 뒤에 있고 감정 반응 없이 댓글 좋아요만 있다', async () => {
    appContainer.resolve('mockDb').works.find((w) => w.id === 'guunmong')!.eps[0].authorNote = '첫 화를 열어 주셔서 고마워요.'
    renderApp('/read/guunmong/1', user())
    await screen.findByRole('heading', { name: '연화봉의 젊은 승려' })
    // jsdom은 레이아웃이 없어 회차 끝 표시가 늘 화면 안에 있으므로 U08로 바뀐다.
    expect(sid()).toBe('U08 회차 끝 · 포크·댓글')
    const note = screen.getByRole('heading', { name: '작가의 말' }).closest('section')!
    expect(document.getElementById('text')!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    screen.getByText('第 一 回')
    expect(document.querySelector('.reader')!.className).toBe('th-hanji themed lite reader')
    expect(document.querySelector('.amb.lite')).toBeTruthy()
    expect(document.querySelector('[data-act="react"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /공감|감동|슬퍼요/ })).toBeNull()
    const like = screen.getByRole('button', { name: '♡ 412' })
    fireEvent.click(like)
    await screen.findByRole('button', { name: '♥ 413' })
    expect(screen.getByRole('button', { name: '‹ 이전 화' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '다음 화 ›' }))
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
    screen.getByText('여기서 포크해 볼까요?')
  })

  it('문장을 골라 댓글을 남기면 인용과 함께 목록에 붙는다', async () => {
    renderApp('/read/postman/1', user())
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    expect(document.querySelector('.s.sel')!.textContent).toBe('“이건 어디로 가야 하지.”')
    fireEvent.click(screen.getByRole('button', { name: '💬 댓글 달기' }))
    const dialog = screen.getByRole('dialog', { name: '문장에 댓글 달기' })
    within(dialog).getByText('댓글만 등록되며 자동 답변은 제공하지 않아요.')
    fireEvent.change(within(dialog).getByLabelText('댓글'), { target: { value: '첫 문장부터 궁금해요' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '등록' }))
    await screen.findByText('첫 문장부터 궁금해요')
    expect(screen.queryByRole('dialog')).toBeNull()
    screen.getByRole('heading', { name: '댓글 3' })
    expect(document.querySelector('.cm:last-of-type .cq')!.textContent).toBe('“이건 어디로 가야 하지.”')
    fireEvent.change(screen.getByPlaceholderText('감상이나 궁금한 점을 남겨 주세요'), { target: { value: '아래 댓글' } })
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await screen.findByRole('heading', { name: '댓글 4' })
  })

  it('피드백은 4가지 유형과 무료 안내를 보여 주고 질문은 응답 완료로 접수한다', async () => {
    renderApp('/read/postman/1', user())
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    fireEvent.click(screen.getByRole('button', { name: '✉ 피드백 보내기' }))
    const dialog = screen.getByRole('dialog', { name: '피드백 보내기' })
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['단순 오류', '스토리 오류', '질문', '제안'])
    within(dialog).getByText(/댓글·단순 오류·스토리 오류·질문·제안은 무료로 등록돼요/)
    fireEvent.change(within(dialog).getByLabelText('피드백 유형'), { target: { value: '스토리 오류' } })
    within(dialog).getByLabelText('스토리 오류 검증 시뮬레이션에 동의')
    fireEvent.change(within(dialog).getByLabelText('피드백 유형'), { target: { value: '질문' } })
    fireEvent.change(within(dialog).getByLabelText('내용'), { target: { value: '누가 보낸 편지인가요?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '피드백 보내기' }))
    await within(dialog).findByText('응답 완료')
    expect(appContainer.resolve('mockDb').reports[0]).toMatchObject({ w: 'postman', n: 1, type: '질문', status: '응답 완료' })
  })

  it('보기 설정은 화면 사이에 유지된다', async () => {
    const { store } = renderApp('/read/guunmong/1', user())
    fireEvent.click(await screen.findByRole('button', { name: '보기 설정' }))
    const dialog = screen.getByRole('dialog', { name: '보기 설정' })
    expect(sid()).toBe('U07 보기 설정 (Aa)')
    fireEvent.click(within(dialog).getByRole('button', { name: '야간' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '가 +' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '끄기' }))
    expect(store.getState().session).toMatchObject({ look: 'night', fs: 20, motion: false })
    expect(document.querySelector('.reader')!.className).toBe('calm rd calm-hanji reader')
    fireEvent.click(dialog.parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('읽은 회차가 홈 이어 읽기에 반영된다', async () => {
    renderApp('/read/starlight/3', user())
    await screen.findByRole('heading', { name: '재의 사절' })
    cleanup()
    renderApp('/', user())
    await screen.findByRole('button', { name: /별빛 서약의 탑 · 3화 재의 사절/ })
  })
})

describe('빠른 이동 (U03)', () => {
  it('Ctrl K와 GNB 검색 버튼으로 열고 고른 항목으로 이동한다', async () => {
    renderApp('/')
    fireEvent.click(await screen.findByRole('button', { name: '소설·인물·회차 검색' }))
    screen.getByRole('dialog', { name: '빠른 이동' })
    expect(sid()).toBe('U03 빠른 이동 (Ctrl K)')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: '빠른 이동' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '팔선녀' } })
    fireEvent.click(await within(dialog).findByText('구운몽 2화 돌다리 위의 팔선녀'))
    await screen.findByText('소설을 읽으려면 로그인해 주세요.')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
