// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

describe('독립 운영 CRUD 화면 (오프라인 데모)', () => {
  it('문의 목록→상세·수정과 답변별 등록·수정·삭제 뒤 문의 삭제까지 지원한다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt()
    await screen.findByText('등록된 운영 문의 기록이 없어요. 문의 기록을 추가해 보세요.')
    fireEvent.click(screen.getByRole('button', { name: '문의 기록 추가' }))
    fill('문의 분류', '기능 확인')
    fill('문의 제목', '운영 문의 CRUD')
    fill('문의 내용', '질문 첫 줄\n둘째 줄')
    fireEvent.click(screen.getByRole('button', { name: '문의 저장' }))
    await screen.findByRole('heading', { name: '운영 문의 CRUD' })
    await waitFor(() => expect(screen.getByLabelText('문의 제목').getAttribute('value')).toBe('운영 문의 CRUD'))
    fill('문의 제목', '수정된 운영 문의')
    fireEvent.click(screen.getByRole('button', { name: '문의 저장' }))
    await screen.findByRole('heading', { name: '수정된 운영 문의' })
    fill('새 답변 내용', '첫 답변')
    fireEvent.click(screen.getByRole('button', { name: '답변 추가' }))
    const reply = await screen.findByRole('article', { name: '답변 1' })
    expect((screen.getByRole('button', { name: '문의 삭제' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(reply).getByLabelText('답변 내용'), { target: { value: '답변 수정' } })
    fireEvent.click(within(reply).getByRole('button', { name: '답변 저장' }))
    await within(reply).findByText('답변 수정', { selector: '.admin-prose' })
    fireEvent.click(within(reply).getByRole('button', { name: '답변 삭제' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: '답변 1' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '문의 삭제' }))
    await screen.findByText('등록된 운영 문의 기록이 없어요. 문의 기록을 추가해 보세요.')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '운영 문의 기록 목록' })))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('문의 선택·초안은 탭 이동과 목록 복귀 후 유지되고 포커스가 상세와 선택 행을 따라간다', async () => {
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: '문의 기록 추가' }))
    fill('문의 분류', '계정')
    fill('문의 제목', '포커스와 초안 문의')
    fill('문의 내용', '본문')
    fireEvent.click(screen.getByRole('button', { name: '문의 저장' }))
    await screen.findByRole('heading', { name: '포커스와 초안 문의' })
    fill('새 답변 내용', '전송 전 초안')
    fireEvent.click(within(menu()).getByRole('link', { name: '공지' }))
    fireEvent.click(within(menu()).getByRole('link', { name: '제보·문의' }))
    expect((await screen.findByLabelText<HTMLTextAreaElement>('새 답변 내용')).value).toBe('전송 전 초안')
    fireEvent.click(screen.getByRole('button', { name: '문의 목록으로' }))
    const select = await screen.findByRole('button', { name: /포커스와 초안 문의.*답변 없음/ })
    await waitFor(() => expect(document.activeElement).toBe(select))
    fireEvent.click(select)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '포커스와 초안 문의' })))
    expect((screen.getByLabelText('새 답변 내용') as HTMLTextAreaElement).value).toBe('전송 전 초안')
  })

  it('운영 문의를 추가해도 기존 회원의 내 문의와 작가 제보 목록에 섞이지 않는다', async () => {
    const { store } = renderAt()
    fireEvent.click(await screen.findByRole('button', { name: '문의 기록 추가' }))
    fill('문의 분류', '운영 전용')
    fill('문의 제목', '회원 화면 비노출 운영기록')
    fill('문의 내용', '운영 독립 기록')
    fireEvent.click(screen.getByRole('button', { name: '문의 저장' }))
    await screen.findByRole('heading', { name: '회원 화면 비노출 운영기록' })
    cleanup()
    renderAt('/me/inquiry', store)
    await screen.findByRole('heading', { name: /내 문의/ })
    expect(screen.queryByText(/회원 화면 비노출 운영기록/)).toBeNull()
  })

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
