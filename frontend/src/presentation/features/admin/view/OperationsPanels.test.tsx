// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../../../../App'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { OperationsError } from '../../../../domain/entities/operations'
import { kstDateTime } from '../../../shared/format'

// 화면 조립·키보드 포커스 회귀는 CI에서만 실행합니다.
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function renderAt(path = '/admin?tab=feedback', store = createAppStore({ role: 'admin' })) {
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]} useTransitions={false}><App /></MemoryRouter></Provider>) }
}
const menu = () => screen.getByRole('navigation', { name: '관리자 업무' })
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

const support = () => appContainer.resolve('supportInquiryUseCase')
const seed = (title: string, body = '문의 본문') => support().create({ category: '계정', title, body })
const region = () => screen.getByRole('region', { name: '회원 고객지원 문의' })
/** 상세의 분류·상태·접수·회원 항목 값 */
const dd = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling?.textContent
/** 처리 버튼은 fieldset[disabled] 안에서 잠기므로 button.disabled가 아니라 fieldset을 본다. */
const enabled = (button: () => HTMLElement) => waitFor(() => expect(button().closest('fieldset')?.disabled).toBe(false))

describe('고객지원 문의 화면 (실제 API 계약, 메모리 대역)', () => {
  it('문의 목록→상세와 답변 등록·수정·삭제를 지원하고 상태가 답변 유무를 따른다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await seed('로그인이 안 돼요', '첫 줄\n둘째 줄')
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: /로그인이 안 돼요.*답변 대기.*답변 0개/ }))
    await screen.findByRole('heading', { name: '로그인이 안 돼요' })
    expect(screen.getByText('첫 줄 둘째 줄', { selector: '.admin-prose' }).textContent).toBe('첫 줄\n둘째 줄')
    expect(dd('분류')).toBe('계정')
    expect(dd('상태')).toBe('답변 대기')
    expect(dd('접수')).not.toBe('')
    expect(dd('회원')).toBe('demo-mem')
    screen.getByText('아직 등록된 답변이 없어요.')

    fireEvent.change(await screen.findByLabelText('새 답변 내용'), { target: { value: '첫 답변' } })
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }))
    const first = await screen.findByRole('article', { name: '답변 1' })
    within(first).getByText('첫 답변', { selector: '.admin-prose' })
    await waitFor(() => expect(dd('상태')).toBe('답변 완료'))
    expect(screen.getByLabelText<HTMLTextAreaElement>('새 답변 내용').value).toBe('')

    await enabled(() => screen.getByRole('button', { name: '답변 등록' }))
    fireEvent.change(screen.getByLabelText('새 답변 내용'), { target: { value: '두 번째 답변' } })
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }))
    within(await screen.findByRole('article', { name: '답변 2' })).getByText('두 번째 답변', { selector: '.admin-prose' })

    await enabled(() => within(first).getByRole('button', { name: '답변 저장' }))
    fireEvent.change(within(first).getByLabelText('답변 내용'), { target: { value: '답변 수정' } })
    fireEvent.click(within(first).getByRole('button', { name: '답변 저장' }))
    await within(first).findByText('답변 수정', { selector: '.admin-prose' })

    await enabled(() => within(first).getByRole('button', { name: '답변 삭제' }))
    fireEvent.click(within(first).getByRole('button', { name: '답변 삭제' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: '답변 2' })).toBeNull())
    const rest = screen.getByRole('article', { name: '답변 1' })
    within(rest).getByText('두 번째 답변', { selector: '.admin-prose' })
    expect(dd('상태')).toBe('답변 완료')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '답변 1개' })))

    await enabled(() => within(rest).getByRole('button', { name: '답변 삭제' }))
    fireEvent.click(within(rest).getByRole('button', { name: '답변 삭제' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: '답변 1' })).toBeNull())
    await waitFor(() => expect(dd('상태')).toBe('답변 대기'))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenCalledWith('이 답변을 삭제할까요? 삭제 후 복구할 수 없어요.')

    fireEvent.click(screen.getByRole('button', { name: '문의 목록으로' }))
    const row = await screen.findByRole('button', { name: /로그인이 안 돼요.*답변 대기/ })
    await waitFor(() => expect(document.activeElement).toBe(row))
  })

  it('상태 필터는 서버 조회 조건으로 답변 대기·답변 완료 문의를 나눠 보여 준다', async () => {
    await seed('필터 대기 문의')
    await seed('필터 완료 문의')
    const answered = (await support().listAll(null)).find((x) => x.title === '필터 완료 문의')!
    await support().addReply(answered.id, '답변')
    renderAt()
    // 필터를 바꾸면 새 조회 결과가 올 때까지 목록이 잠시 비므로, 두 행의 표시 여부를 함께 기다린다.
    const shown = (waiting: boolean, done: boolean) => waitFor(() => {
      expect(!!screen.queryByRole('button', { name: /필터 대기 문의/ })).toBe(waiting)
      expect(!!screen.queryByRole('button', { name: /필터 완료 문의/ })).toBe(done)
    })
    await shown(true, true)
    fill('상태', 'WAITING')
    await shown(true, false)
    fill('상태', 'ANSWERED')
    await shown(false, true)
    fill('상태', 'all')
    await shown(true, true)
  })

  it('선택한 문의는 다른 탭에 다녀와도 유지된다', async () => {
    await seed('선택 유지 문의')
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: /선택 유지 문의/ }))
    await screen.findByRole('heading', { name: '선택 유지 문의' })
    fireEvent.click(within(menu()).getByRole('link', { name: '공지' }))
    fireEvent.click(within(menu()).getByRole('link', { name: '제보·문의' }))
    await screen.findByRole('heading', { name: '선택 유지 문의' })
    await screen.findByLabelText('새 답변 내용')
  })

  it('목록 조회가 실패해도 빈 목록으로 숨기지 않고 다시 불러올 수 있다', async () => {
    await seed('재시도 문의')
    vi.spyOn(support(), 'listAll').mockRejectedValueOnce(new OperationsError('이 작업을 할 권한이 없어요.'))
    renderAt()
    await screen.findByText(/회원 문의 목록을 불러오지 못했어요/)
    expect(screen.queryByText('조건에 맞는 문의가 없어요.')).toBeNull()
    expect(screen.queryByRole('button', { name: /재시도 문의/ })).toBeNull()
    fireEvent.click(within(region()).getByRole('button', { name: '다시 불러오기' }))
    await screen.findByRole('button', { name: /재시도 문의/ })
    expect(screen.queryByText(/회원 문의 목록을 불러오지 못했어요/)).toBeNull()
  })

  it('답변 등록이 거절되면 입력을 그대로 두고 권한 없음을 안내한다', async () => {
    await seed('권한 없는 문의')
    vi.spyOn(support(), 'addReply').mockRejectedValueOnce(new OperationsError('이 작업을 할 권한이 없어요.'))
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: /권한 없는 문의/ }))
    fireEvent.change(await screen.findByLabelText('새 답변 내용'), { target: { value: '남아야 하는 답변' } })
    fireEvent.click(screen.getByRole('button', { name: '답변 등록' }))
    await within(region()).findByText('이 작업을 할 권한이 없어요.')
    expect(screen.getByLabelText<HTMLTextAreaElement>('새 답변 내용').value).toBe('남아야 하는 답변')
    await enabled(() => screen.getByRole('button', { name: '답변 등록' }))
    expect(screen.queryByRole('article', { name: '답변 1' })).toBeNull()
  })

  it('답변 등록 중에는 입력을 잠그고 중복 전송하지 않는다', async () => {
    await seed('중복 방지 문의')
    let finish!: () => void
    const add = vi.spyOn(support(), 'addReply').mockImplementation(() => new Promise<void>((done) => { finish = done }))
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: /중복 방지 문의/ }))
    fireEvent.change(await screen.findByLabelText('새 답변 내용'), { target: { value: '답변' } })
    const form = screen.getByLabelText('새 답변 내용').closest('form')!
    fireEvent.submit(form)
    expect((await screen.findByRole('button', { name: '등록 중…' })).closest('fieldset')?.disabled).toBe(true)
    fireEvent.submit(form)
    expect(add).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    await within(region()).findByText('답변을 등록했어요.')
  })
})

describe('독립 운영 CRUD 화면 (오프라인 데모)', () => {
  it('공지 상세·수정·삭제에서 줄바꿈과 취소 시 원본을 보존한다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAt('/admin?tab=notices')
    fireEvent.click(await screen.findByRole('button', { name: '공지 작성' }))
    fill('공지 제목', '독립 공지')
    fill('공지 내용', '첫 줄\n둘째 줄')
    fireEvent.click(screen.getByRole('button', { name: '공지 저장' }))
    await screen.findByRole('heading', { name: '독립 공지' })
    expect(screen.getByText('첫 줄 둘째 줄', { selector: '.admin-prose' }).textContent).toBe('첫 줄\n둘째 줄')
    fill('공지 제목', '독립 공지 수정')
    fireEvent.click(screen.getByRole('button', { name: '공지 저장' }))
    await screen.findByRole('heading', { name: '독립 공지 수정' })
    fireEvent.click(screen.getByRole('button', { name: '공지 삭제' }))
    expect(screen.getByRole('heading', { name: '독립 공지 수정' })).toBeTruthy()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '공지 삭제' }))
    await screen.findByText('등록된 운영 공지가 없어요. 공지를 작성해 보세요.')
  })

  it('완료 문구는 한 곳에만 보인다: 폼이 바뀌거나 사라진 조치는 화면 위 완료 줄에, 폼이 남아 있는 조치는 폼 안에', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/admin?tab=notices')
    // 토스트(div#toast)에도 같은 문구가 뜨므로 화면에 남는 안내 문단만 센다.
    const lines = (text: string) => screen.getAllByText(text, { selector: 'p' })
    const inForm = (line: HTMLElement) => line.closest('[aria-label="운영 공지"]') !== null
    const saved = '공지를 저장했어요. 회원 공지사항에 바로 공개돼요.'
    fireEvent.click(await screen.findByRole('button', { name: '공지 작성' }))
    fill('공지 제목', '한 곳 공지')
    fill('공지 내용', '본문')
    fireEvent.click(screen.getByRole('button', { name: '공지 저장' }))
    await screen.findByRole('heading', { name: '한 곳 공지' })
    // 새 공지 폼은 저장 뒤 상세로 바뀌어 사라졌으므로 화면 위 완료 줄이 알린다.
    expect(lines(saved)).toHaveLength(1)
    expect(inForm(lines(saved)[0])).toBe(false)

    fill('공지 제목', '한 곳 공지 수정')
    fireEvent.click(screen.getByRole('button', { name: '공지 저장' }))
    await screen.findByRole('heading', { name: '한 곳 공지 수정' })
    // 고친 공지의 폼은 그대로 남아 있으므로 폼 안에서만 알린다.
    await waitFor(() => expect(inForm(lines(saved)[0])).toBe(true))
    expect(lines(saved)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '공지 삭제' }))
    await screen.findByText('등록된 운영 공지가 없어요. 공지를 작성해 보세요.')
    // 삭제로 폼이 사라졌으므로 삭제 완료도 화면 위 완료 줄이 알린다.
    expect(lines('공지를 삭제했어요. 회원 공지사항에서도 사라져요.')).toHaveLength(1)
  })

  it('이벤트의 선택 한국시간 입력·UTC 저장·역전 오류와 탭 초안 보존을 안내한다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/admin?tab=events')
    fireEvent.click(await screen.findByRole('button', { name: '이벤트 작성' }))
    fill('이벤트 제목', '시간대 이벤트')
    fill('이벤트 내용', '줄1\n줄2')
    fill('시작 (한국시간)', '2026-11-05T10:00')
    fill('종료 (한국시간)', '2026-11-05T09:00')
    fireEvent.click(screen.getByRole('button', { name: '이벤트 저장' }))
    await screen.findByRole('alert', { name: '' })
    within(screen.getByRole('region', { name: '운영 이벤트' })).getByText('종료는 시작과 같거나 늦어야 해요.')
    fireEvent.click(within(menu()).getByRole('link', { name: '공지' }))
    fireEvent.click(within(menu()).getByRole('link', { name: '이벤트' }))
    expect((screen.getByLabelText('이벤트 제목') as HTMLInputElement).value).toBe('시간대 이벤트')
    fill('종료 (한국시간)', '')
    fireEvent.click(screen.getByRole('button', { name: '이벤트 저장' }))
    await screen.findByRole('heading', { name: '시간대 이벤트' })
    screen.getByText(/UTC: 2026-11-05T01:00:00.000Z/)
    expect(within(screen.getByRole('region', { name: '운영 이벤트' })).queryByRole('button', { name: '상태 변경' })).toBeNull()
    fill('이벤트 제목', '수정된 시간대 이벤트')
    fill('시작 (한국시간)', '')
    fireEvent.click(screen.getByRole('button', { name: '이벤트 저장' }))
    await screen.findByRole('heading', { name: '수정된 시간대 이벤트' })
    screen.getByText('UTC: 시작 미정 / 종료 미정')
    fireEvent.click(screen.getByRole('button', { name: '이벤트 목록으로' }))
    fireEvent.click(screen.getByRole('button', { name: /수정된 시간대 이벤트.*시작 미정/ }))
    expect((screen.getByLabelText('시작 (한국시간)') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '이벤트 삭제' }))
    await screen.findByText('등록된 운영 이벤트가 없어요. 이벤트를 작성해 보세요.')
  })
})

describe('공지 탭 (운영 공지 API, 메모리 fixture)', () => {
  it('운영 API 연결 탭이며 서버에 저장되지 않는다는 데모 문구와 구 공지 데모가 없다', async () => {
    renderAt('/admin?tab=notices')
    await screen.findByRole('button', { name: '공지 작성' })
    screen.getByText('운영 API 연결')
    expect(screen.queryByText(/서버에 저장되지 않아요/)).toBeNull()
    expect(screen.queryByText('기존 회원 공지 표')).toBeNull()
    expect(screen.queryByText('기존 회원 화면 공지 데모')).toBeNull()
    screen.getByText('저장한 공지는 바로 회원 공지사항에 공개돼요. 예약·고정·회원 알림은 지원하지 않아요.')
  })

  it('공지 목록 조회 실패는 빈 목록으로 숨기지 않고 다시 불러오기로 복구한다', async () => {
    const list = vi.spyOn(appContainer.resolve('noticeUseCase'), 'list').mockRejectedValueOnce(new Error('서버 오류'))
    renderAt('/admin?tab=notices')
    await screen.findByText(/공지 목록을 불러오지 못했어요/)
    expect(screen.queryByText('등록된 운영 공지가 없어요. 공지를 작성해 보세요.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('등록된 운영 공지가 없어요. 공지를 작성해 보세요.')
    expect(screen.queryByText(/공지 목록을 불러오지 못했어요/)).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('저장 실패(권한 없음 등)는 입력을 남기고 안내 문구로 보인다', async () => {
    vi.spyOn(appContainer.resolve('noticeUseCase'), 'save').mockRejectedValueOnce(new OperationsError('이 작업을 할 권한이 없어요.'))
    renderAt('/admin?tab=notices')
    fireEvent.click(await screen.findByRole('button', { name: '공지 작성' }))
    fill('공지 제목', '권한 없는 공지')
    fill('공지 내용', '본문')
    fireEvent.click(screen.getByRole('button', { name: '공지 저장' }))
    await within(screen.getByRole('region', { name: '운영 공지' })).findByText('이 작업을 할 권한이 없어요.')
    expect((screen.getByLabelText('공지 제목') as HTMLInputElement).value).toBe('권한 없는 공지')
    expect(screen.queryByText(/공지를 저장했어요/)).toBeNull()
  })
})

// 이벤트 탭은 운영 API(대역: 메모리 저장소)를 쓴다. 실패는 빈 목록·성공으로 숨기지 않고 입력은 지킨다.
describe('이벤트 운영 API 화면', () => {
  const repository = () => appContainer.resolve('eventRepository')
  const useCase = () => appContainer.resolve('eventUseCase')
  const region = () => screen.getByRole('region', { name: '운영 이벤트' })
  const seeded: string[] = []
  const seed = async (title: string, startsAt: string | null, endsAt: string | null) => {
    const row = await repository().create({ title, body: `${title} 본문`, startsAt, endsAt })
    seeded.push(row.id)
    return row
  }
  afterEach(async () => { for (const id of seeded.splice(0)) await repository().remove(id).catch(() => {}) })

  it('목록은 진행 상태 칩과 한국시간 기간을 보여 주고 데모 표기가 없다', async () => {
    await seed('상시 이벤트', null, null)
    await seed('예정 이벤트', '2999-01-01T00:00:00.000Z', null)
    await seed('진행 이벤트', '2020-01-01T00:00:00.000Z', null)
    await seed('종료 이벤트', null, '2020-01-02T00:00:00.000Z')
    renderAt('/admin?tab=events')
    for (const [title, chip] of [['상시 이벤트', '상시'], ['예정 이벤트', '예정'], ['진행 이벤트', '진행 중'], ['종료 이벤트', '종료']]) {
      within(await screen.findByRole('button', { name: new RegExp(title) })).getByText(chip)
    }
    within(screen.getByRole('button', { name: /진행 이벤트/ })).getByText(`${kstDateTime('2020-01-01T00:00:00.000Z')} ~ 종료 미정 · 한국시간`)
    expect(region().textContent).not.toContain('데모')
    screen.getByText('운영 API 연결')
  })

  it('저장이 실패하면 입력을 지키고 안내하며, 응답을 기다리는 동안 다시 보낼 수 없다', async () => {
    let fail!: (error: Error) => void
    const save = vi.spyOn(useCase(), 'save').mockImplementationOnce(() => new Promise<never>((_, reject) => { fail = reject }))
    renderAt('/admin?tab=events')
    fireEvent.click(await screen.findByRole('button', { name: '이벤트 작성' }))
    fill('이벤트 제목', '실패해도 남을 제목')
    fill('이벤트 내용', '첫 줄\n둘째 줄')
    fill('시작 (한국시간)', '2026-11-05T10:00')
    fireEvent.click(screen.getByRole('button', { name: '이벤트 저장' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '저장 중…' }).closest('fieldset')?.disabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '저장 중…' }))
    expect(save).toHaveBeenCalledTimes(1)
    fail(new OperationsError('이 작업을 할 권한이 없어요.'))
    await within(region()).findByText('이 작업을 할 권한이 없어요.')
    expect((screen.getByLabelText('이벤트 제목') as HTMLInputElement).value).toBe('실패해도 남을 제목')
    expect((screen.getByLabelText('이벤트 내용') as HTMLTextAreaElement).value).toBe('첫 줄\n둘째 줄')
    expect((screen.getByLabelText('시작 (한국시간)') as HTMLInputElement).value).toBe('2026-11-05T10:00')
    expect(screen.getByRole('button', { name: '이벤트 저장' }).closest('fieldset')?.disabled).toBe(false)
    expect(await repository().listAdmin()).toEqual([])
  })

  it('목록을 불러오지 못하면 빈 목록으로 숨기지 않고 다시 불러오기로 복구한다', async () => {
    await seed('복구 이벤트', null, null)
    const list = vi.spyOn(useCase(), 'listAdmin').mockRejectedValueOnce(new Error('boom'))
    renderAt('/admin?tab=events')
    await screen.findByText(/이벤트 목록을 불러오지 못했어요/)
    expect(screen.queryByText('등록된 운영 이벤트가 없어요. 이벤트를 작성해 보세요.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByRole('button', { name: /복구 이벤트/ })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('삭제는 확인을 거치고 서버가 거절하면 안내하며 이벤트를 남기고, 성공하면 공개 목록에서도 사라진다', async () => {
    const row = await seed('삭제 대상', null, null)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderAt('/admin?tab=events')
    fireEvent.click(await screen.findByRole('button', { name: /삭제 대상/ }))
    fireEvent.click(await screen.findByRole('button', { name: '이벤트 삭제' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(await repository().getPublic(row.id)).not.toBeNull()
    confirm.mockReturnValue(true)
    vi.spyOn(useCase(), 'remove').mockRejectedValueOnce(new OperationsError('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'))
    fireEvent.click(screen.getByRole('button', { name: '이벤트 삭제' }))
    await within(region()).findByText('대상을 찾을 수 없어요. 목록을 새로고침해 주세요.')
    screen.getByRole('heading', { name: '삭제 대상' })
    expect(await repository().getPublic(row.id)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '이벤트 삭제' }))
    await screen.findByText('등록된 운영 이벤트가 없어요. 이벤트를 작성해 보세요.')
    expect(await useCase().listPublic()).toEqual([])
  })
})
