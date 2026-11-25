// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { SerialBoardRecord, SerialSettings } from '../../../../domain/entities/aiSerial'
import { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { fakeSerialRepo, record, settings } from '../../../../test/serialFixtures'
import { kstDateTime } from '../../../shared/format'
import { AiSerialPanel } from './AiSerialPanel'

afterEach(cleanup)

const fakeRepo = (saved?: SerialSettings, rows?: SerialBoardRecord[]) => fakeSerialRepo({ saved, rows })
/** 연재 설정 탭(처음 열리는 탭)을 연다. onOpenSettings는 호출 측(작품 관리)이 운영 설정 탭으로 옮기는 함수이고, 빼면 호출 측이 이동을 잠근 경우다. */
const open = async (repo = fakeRepo(), props: { onOpenSettings?: () => void } = {}) => {
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(repo)} {...props} />)
  await screen.findByRole('button', { name: '설정 저장' })
  return repo
}
const subTab = (name: string) => screen.getByRole('tab', { name })
/** 게시판 기록 탭으로 옮긴다. */
const toHistory = () => fireEvent.click(subTab('게시판 기록'))
const openHistory = async (repo = fakeRepo()) => {
  await open(repo)
  toHistory()
  await screen.findByRole('table')
  return repo
}
const save = () => screen.getByRole('button', { name: '설정 저장' })
const run = () => screen.getByRole('button', { name: '지금 마감·실행' })
const day = (name: string) => screen.getByRole('checkbox', { name })
/** 브라우저가 disabled가 된 버튼에서 초점을 거두는 것을 재현한다(jsdom은 disabled 요소의 blur()를 무시한다). */
function dropFocus() {
  const probe = document.body.appendChild(document.createElement('input'))
  probe.focus()
  probe.remove()
  expect(document.activeElement).toBe(document.body)
}

it('서버 설정으로 입력 칸을 채우고 저장 버튼은 바꾸기 전까지 잠겨 있다', async () => {
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(fakeRepo(settings({ direction: '긴장감 있게' })))} />)
  expect(screen.getByRole('status').textContent).toContain('불러오고 있어요')
  await screen.findByRole('button', { name: '설정 저장' })
  // 켜기·끄기는 운영 설정의 집필 방식이 정한다: 이 탭에는 켜기 토글이 없고 체크박스는 요일 일곱뿐이다.
  expect(screen.queryByRole('checkbox', { name: 'AI 집필 켜기' })).toBeNull()
  expect(screen.getAllByRole('checkbox')).toHaveLength(7)
  expect(['월', '화', '수', '목', '금', '토', '일'].map((name) => (day(name) as HTMLInputElement).checked)).toEqual([true, false, false, true, false, false, false])
  expect((screen.getByLabelText(/연재 시각/) as HTMLInputElement).value).toBe('21:00')
  expect((screen.getByLabelText(/연재 방향/) as HTMLTextAreaElement).value).toBe('긴장감 있게')
  expect((save() as HTMLButtonElement).disabled).toBe(true)
})

it('입력을 바꿔 저장하면 다듬은 값을 보내고 저장 결과를 알린 뒤 다시 잠긴다', async () => {
  const repo = await open()
  fireEvent.click(day('금'))
  fireEvent.change(screen.getByLabelText(/연재 시각/), { target: { value: '22:30' } })
  fireEvent.change(screen.getByLabelText(/연재 방향/), { target: { value: ' 반전을 넣어 주세요 ' } })
  repo.settings.mockResolvedValue(settings({ days: ['MON', 'THU', 'FRI'], time: '22:30', direction: '반전을 넣어 주세요' }))
  expect((save() as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(save())
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('설정을 저장했어요'))
  // 요일·시각·방향만 보낸다(켜짐은 보내지 않는다).
  expect(repo.saveSettings).toHaveBeenCalledWith('w1', { days: ['MON', 'THU', 'FRI'], time: '22:30', direction: '반전을 넣어 주세요' }, expect.any(AbortSignal))
  expect((save() as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText(/연재 방향/) as HTMLTextAreaElement).value).toBe('반전을 넣어 주세요')
})

it('요일을 모두 끄면 이유를 알리고 저장을 잠근다 (세계관 연결은 묻지 않는다)', async () => {
  await open()
  fireEvent.click(day('월'))
  fireEvent.click(day('목'))
  expect(screen.getByText('연재 요일을 하나 이상 골라 주세요.')).toBeTruthy()
  expect((save() as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByText(/세계관/)).toBeNull()
})

it('저장이 거절되면 서버 문구를 경고로 알리고 입력은 그대로 둔다', async () => {
  const repo = fakeRepo()
  repo.saveSettings.mockRejectedValueOnce(new Error('작품 소유자만 할 수 있어요.'))
  await open(repo)
  fireEvent.change(screen.getByLabelText(/연재 방향/), { target: { value: '새 방향' } })
  fireEvent.click(save())
  expect((await screen.findByRole('alert')).textContent).toContain('작품 소유자만 할 수 있어요.')
  expect((screen.getByLabelText(/연재 방향/) as HTMLTextAreaElement).value).toBe('새 방향')
  expect((save() as HTMLButtonElement).disabled).toBe(false)
})

// 하위 탭: '연재 설정'(요일·시각·방향)과 '게시판 기록'(지금 마감·실행·기록 새로 고침·기록 표)이다(계약 '화면').
it('하위 탭은 연재 설정·게시판 기록 둘이고 연재 설정이 처음 열리며, 설정 입력과 기록·실행은 각자의 탭에만 있다', async () => {
  await open()
  expect(within(screen.getByRole('tablist', { name: 'AI 집필 하위 탭' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['연재 설정', '게시판 기록'])
  expect(subTab('연재 설정').getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(subTab('연재 설정').id)
  expect(screen.getByLabelText(/연재 시각/)).toBeTruthy()
  for (const name of ['지금 마감·실행', '기록 새로 고침']) expect(screen.queryByRole('button', { name }), name).toBeNull()
  expect(screen.queryByRole('table')).toBeNull()
  toHistory()
  await screen.findByRole('table')
  expect(subTab('게시판 기록').getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(subTab('게시판 기록').id)
  for (const name of ['지금 마감·실행', '기록 새로 고침']) expect(screen.getByRole('button', { name }), name).toBeTruthy()
  expect(screen.queryByLabelText(/연재 시각/)).toBeNull()
  expect(screen.queryByRole('button', { name: '설정 저장' })).toBeNull()
})

it('하위 탭은 방향키·Home·End로 옮기고 선택한 탭만 Tab 순서에 들어가며, 알림은 요청을 보낸 탭에서만 보인다', async () => {
  const repo = await open()
  const stops = () => ['연재 설정', '게시판 기록'].map((name) => subTab(name).tabIndex)
  expect(stops()).toEqual([0, -1])
  fireEvent.change(screen.getByLabelText(/연재 방향/), { target: { value: '새 방향' } })
  fireEvent.click(save())
  await waitFor(() => expect(repo.saveSettings).toHaveBeenCalled())
  await screen.findByRole('status')
  subTab('연재 설정').focus()
  fireEvent.keyDown(subTab('연재 설정'), { key: 'ArrowRight' })
  expect(document.activeElement).toBe(subTab('게시판 기록'))
  expect(subTab('게시판 기록').getAttribute('aria-selected')).toBe('true')
  expect(stops()).toEqual([-1, 0])
  await screen.findByRole('table')
  expect(screen.queryByText('설정을 저장했어요.')).toBeNull() // 설정 저장의 알림은 다른 탭에 보이지 않는다
  fireEvent.keyDown(subTab('게시판 기록'), { key: 'ArrowRight' })
  expect(document.activeElement).toBe(subTab('연재 설정'))
  expect(screen.getByText('설정을 저장했어요.')).toBeTruthy() // 저장을 보낸 탭으로 돌아오면 보인다
  fireEvent.keyDown(subTab('연재 설정'), { key: 'End' })
  expect(document.activeElement).toBe(subTab('게시판 기록'))
  fireEvent.keyDown(subTab('게시판 기록'), { key: 'Home' })
  expect(document.activeElement).toBe(subTab('연재 설정'))
})

it('게시판 기록 표에 대상 회차·상태·발행 회차·실패 사유·마감 시각을 보이고, 실패 사유는 서버 문구 그대로다', async () => {
  const closed = '2026-11-22T12:00:00Z'
  await openHistory(fakeRepo(settings(), [
    record({ id: 'b5', episodeNumber: 7, status: 'open' }),
    record({ id: 'b4', episodeNumber: 6, status: 'failed', failureReason: '크레딧 상한을 넘었습니다.', closedAt: closed }),
    record({ id: 'b3', episodeNumber: 5, status: 'failed', failureReason: '크레딧이 부족합니다.', closedAt: closed }),
    record({ id: 'b2', episodeNumber: 4, status: 'failed', failureReason: '검수를 통과하지 못했습니다.', closedAt: closed }),
    record({ id: 'b1', episodeNumber: 3, status: 'published', publishedEpisodeNumber: 3, closedAt: closed }),
  ]))
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['대상 회차', '상태', '발행 회차', '실패 사유', '마감 시각'])
  const rows = within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
  expect(rows).toEqual([
    ['7화', '투표·제안 받는 중', '—', '—', '—'],
    ['6화', '실패', '—', '크레딧 상한을 넘었습니다.', kstDateTime(closed)],
    ['5화', '실패', '—', '크레딧이 부족합니다.', kstDateTime(closed)],
    ['4화', '실패', '—', '검수를 통과하지 못했습니다.', kstDateTime(closed)],
    ['3화', '발행됨', '3화', '—', kstDateTime(closed)],
  ])
})

it('기록이 없으면 안내를 보인다', async () => {
  await open(fakeRepo(settings(), []))
  toHistory()
  expect(await screen.findByText(/아직 게시판 기록이 없어요/)).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it('열린 게시판이 있고 켜져 있으면 지금 마감·실행을 요청하고 202 뒤 기록을 다시 읽어 실행 대기를 보인다', async () => {
  const repo = await openHistory()
  expect((run() as HTMLButtonElement).disabled).toBe(false)
  repo.boards.mockResolvedValue([record({ status: 'queued' })])
  fireEvent.click(run())
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('실행을 요청했어요'))
  expect(repo.run).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
  await waitFor(() => expect(within(screen.getByRole('table')).getByText('실행 대기')).toBeTruthy())
  expect((run() as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(/이미 실행 중이에요/)).toBeTruthy()
})

it.each([
  ['꺼져 있으면', settings({ enabled: false }), [record()], '자율 집필을 고르면 실행할 수 있어요'],
  ['열린 게시판이 없으면', settings(), [record({ status: 'published', publishedEpisodeNumber: 4 })], '열린 게시판이 없어요'],
])('%s 지금 마감·실행이 잠기고 이유를 알린다', async (_name, saved, rows, why) => {
  await openHistory(fakeRepo(saved, rows))
  expect((run() as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(new RegExp(why)).id).toBe(run().getAttribute('aria-describedby'))
})

// AI 자율 집필은 운영 설정의 집필 방식에서 고른다(계약 'AI 자율 집필 = 집필 방식'). 꺼져 있으면 이 탭은 꺼짐 상태를 알리고, 켜는 길은 리드 문단이 적는다.
it('꺼져 있으면 꺼짐 상태를 알리고(켜는 길은 리드 문단), 켜져 있으면 알리지 않는다', async () => {
  const GUIDE = 'AI 자율 집필이 꺼져 있어요.'
  await open(fakeRepo(settings({ enabled: false })))
  expect(screen.getByText(GUIDE)).toBeTruthy()
  expect(screen.getAllByText(/운영 설정 > 집필 방식에서 AI 자율 집필을 고르면/)).toHaveLength(1) // 리드 문단에만 있다
  cleanup()
  await open(fakeRepo(settings({ enabled: true })))
  expect(screen.queryByText(GUIDE)).toBeNull()
})

it('[critique] 꺼져 있을 때 운영 설정 열기를 누르면 호출 측 이동을 부르고, 이동을 주지 않으면 버튼이 없다', async () => {
  const onOpenSettings = vi.fn()
  await open(fakeRepo(settings({ enabled: false })), { onOpenSettings })
  fireEvent.click(screen.getByRole('button', { name: '운영 설정 열기' }))
  expect(onOpenSettings).toHaveBeenCalledOnce()
  cleanup()
  await open(fakeRepo(settings({ enabled: false })))
  expect(screen.queryByRole('button', { name: '운영 설정 열기' })).toBeNull()
})

it('[critique] 꺼져 있으면 연재 설정 폼 전체(요일·시각·방향·저장)가 fieldset disabled로 잠기고, 켜져 있으면 입력할 수 있다', async () => {
  // fieldset disabled는 안의 입력을 :disabled로 만든다(입력 요소의 disabled 속성 값은 자기 속성만 읽는다).
  const locked = () => [day('월'), screen.getByLabelText(/연재 시각/), screen.getByLabelText(/연재 방향/), save()].map((el) => el.matches(':disabled'))
  await open(fakeRepo(settings({ enabled: false })))
  expect(locked()).toEqual([true, true, true, true])
  expect(screen.getByLabelText(/연재 시각/).closest('fieldset.ep-serial-fields')?.hasAttribute('disabled')).toBe(true)
  cleanup()
  await open(fakeRepo(settings({ enabled: true })))
  expect(locked()).toEqual([false, false, false, true]) // 저장은 바꾸기 전까지 잠겨 있다(위 첫 테스트)
})

it('실행 요청이 409로 거절되면 서버 문구를 경고로 알린다', async () => {
  const repo = fakeRepo()
  repo.run.mockRejectedValueOnce(new Error('이미 실행 중이에요.'))
  await openHistory(repo)
  fireEvent.click(run())
  expect((await screen.findByRole('alert')).textContent).toContain('이미 실행 중이에요.')
})

// 저장·실행 중 눌렀던 버튼이 잠기면 브라우저가 초점을 거둔다. 끝난 뒤에도 그 버튼이 잠겨 있으면(저장됨·이미 실행 중) 돌아갈 곳이 없어 현재 하위 탭으로 돌려준다.
it('[D2] 저장이 끝났는데 버튼이 계속 잠겨 초점이 body로 떨어졌으면 현재 하위 탭으로 돌려준다', async () => {
  let finish!: () => void
  const repo = fakeRepo()
  repo.saveSettings.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  await open(repo)
  fireEvent.change(screen.getByLabelText(/연재 방향/), { target: { value: '새 방향' } })
  repo.settings.mockResolvedValue(settings({ direction: '새 방향' }))
  const button = save() as HTMLButtonElement
  button.focus()
  fireEvent.click(button)
  await screen.findByRole('button', { name: '저장 중…' })
  dropFocus()
  await act(async () => { finish() })
  await waitFor(() => expect(document.activeElement).toBe(subTab('연재 설정')))
  expect(button.disabled).toBe(true)
})

/** 지금 마감·실행을 눌러 요청 중으로 두고, 잠긴 버튼에서 초점이 거둬진(body) 상태까지 만든다. finish()가 요청을 끝내면 대기 중인 기록이 와서 버튼은 계속 잠긴다. */
async function pendingRun() {
  let end!: () => void
  const repo = await openHistory()
  repo.run.mockImplementation(() => new Promise<void>((resolve) => { end = resolve }))
  repo.boards.mockResolvedValue([record({ status: 'queued' })])
  const button = run() as HTMLButtonElement
  button.focus()
  fireEvent.click(button)
  await screen.findByRole('button', { name: '요청 중…' })
  dropFocus()
  return { button, finish: () => act(async () => { end() }) }
}

it('[D2] 지금 마감·실행 요청이 끝났는데 버튼이 계속 잠겨 초점이 body로 떨어졌으면 게시판 기록 탭으로 돌려준다', async () => {
  const { button, finish } = await pendingRun()
  await finish()
  await waitFor(() => expect(document.activeElement).toBe(subTab('게시판 기록')))
  await waitFor(() => expect(button.disabled).toBe(true)) // 이미 실행 중이라 계속 잠겨 있다
})

it('[D2] 끝났을 때 초점이 body가 아니면(그새 다른 버튼으로 옮겼으면) 가져가지 않는다', async () => {
  const { button, finish } = await pendingRun()
  const refresh = screen.getByRole('button', { name: '기록 새로 고침' })
  refresh.focus()
  await finish()
  await waitFor(() => expect(button.disabled).toBe(true))
  expect(document.activeElement).toBe(refresh)
})

it('저장은 성공했는데 설정을 다시 읽다 실패하면 저장 완료와 읽기 실패를 따로 알리고 입력 칸은 그대로 둔다', async () => {
  const repo = await open()
  fireEvent.change(screen.getByLabelText(/연재 방향/), { target: { value: '새 방향' } })
  repo.settings.mockRejectedValueOnce(new Error('설정 서버 오류'))
  fireEvent.click(save())
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('설정을 저장했어요'))
  const failure = await screen.findByRole('alert')
  expect(failure.textContent).toContain('저장은 됐')
  expect(failure.textContent).toContain('설정 서버 오류')
  expect((screen.getByLabelText(/연재 방향/) as HTMLTextAreaElement).value).toBe('새 방향')
  expect((save() as HTMLButtonElement).disabled).toBe(true)
})

it('설정을 읽지 못하면 입력 칸 대신 실패와 다시 불러오기를 보인다 (빈 설정으로 채우지 않는다)', async () => {
  const repo = fakeRepo()
  repo.settings.mockRejectedValueOnce(new Error('설정 서버 오류'))
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(repo)} />)
  expect((await screen.findByRole('alert')).textContent).toContain('설정 서버 오류')
  expect(screen.queryByRole('button', { name: '설정 저장' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  expect(await screen.findByRole('button', { name: '설정 저장' })).toBeTruthy()
})

it('기록만 읽지 못하면 설정은 그대로 두고 기록 실패와 새로 고침을 보인다', async () => {
  const repo = fakeRepo()
  repo.boards.mockRejectedValueOnce(new Error('기록 서버 오류'))
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(repo)} />)
  await screen.findByRole('button', { name: '설정 저장' })
  toHistory()
  expect((await screen.findByRole('alert')).textContent).toContain('기록 서버 오류')
  expect(screen.queryByRole('table')).toBeNull()
  // 읽지 못한 채로 '불러오는 중'이라고 하지 않고 실패라고 알려 준다.
  expect((run() as HTMLButtonElement).disabled).toBe(true)
  const why = screen.getByText(/불러오지 못해/)
  expect(why.id).toBe(run().getAttribute('aria-describedby'))
  fireEvent.click(screen.getByRole('button', { name: '기록 새로 고침' }))
  expect(await screen.findByRole('table')).toBeTruthy()
})
