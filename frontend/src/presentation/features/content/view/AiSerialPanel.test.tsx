// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { SERIAL_ERROR_MESSAGES, type SerialBoardRecord, type SerialSettings } from '../../../../domain/entities/aiSerial'
import { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { fakeSerialRepo, record, settings } from '../../../../test/serialFixtures'
import { kstDateTime } from '../../../shared/format'
import { AiSerialPanel } from './AiSerialPanel'

afterEach(cleanup)

const fakeRepo = (saved?: SerialSettings, rows?: SerialBoardRecord[]) => fakeSerialRepo({ saved, rows })
const open = async (repo = fakeRepo()) => {
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(repo)} />)
  await screen.findByRole('checkbox', { name: 'AI 집필 켜기' })
  await screen.findByRole('table')
  return repo
}
const save = () => screen.getByRole('button', { name: '설정 저장' })
const run = () => screen.getByRole('button', { name: '지금 마감·실행' })
const day = (name: string) => screen.getByRole('checkbox', { name })

it('서버 설정으로 입력 칸을 채우고 저장 버튼은 바꾸기 전까지 잠겨 있다', async () => {
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(fakeRepo(settings({ direction: '긴장감 있게' })))} />)
  expect(screen.getByRole('status').textContent).toContain('불러오고 있어요')
  await screen.findByRole('checkbox', { name: 'AI 집필 켜기' })
  await screen.findByRole('table')
  expect((screen.getByRole('checkbox', { name: 'AI 집필 켜기' }) as HTMLInputElement).checked).toBe(true)
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
  expect(repo.saveSettings).toHaveBeenCalledWith('w1', { enabled: true, days: ['MON', 'THU', 'FRI'], time: '22:30', direction: '반전을 넣어 주세요' }, expect.any(AbortSignal))
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

it('게시판 기록 표에 대상 회차·상태·발행 회차·실패 사유·마감 시각을 보인다', async () => {
  const closed = '2026-11-22T12:00:00Z'
  await open(fakeRepo(settings(), [
    record({ id: 'b3', episodeNumber: 6, status: 'open' }),
    record({ id: 'b2', episodeNumber: 5, status: 'failed', failureReason: '검수를 통과하지 못했습니다.', closedAt: closed }),
    record({ id: 'b1', episodeNumber: 4, status: 'published', publishedEpisodeNumber: 4, closedAt: closed }),
  ]))
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['대상 회차', '상태', '발행 회차', '실패 사유', '마감 시각'])
  const rows = within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
  expect(rows).toEqual([
    ['6화', '의견 받는 중', '—', '—', '—'],
    ['5화', '실패', '—', '검수를 통과하지 못했습니다.', kstDateTime(closed)],
    ['4화', '발행됨', '4화', '—', kstDateTime(closed)],
  ])
})

it('기록이 없으면 안내를 보인다', async () => {
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(fakeRepo(settings(), []))} />)
  expect(await screen.findByText(/아직 게시판 기록이 없어요/)).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it('열린 게시판이 있고 켜져 있으면 지금 마감·실행을 요청하고 202 뒤 기록을 다시 읽어 실행 대기를 보인다', async () => {
  const repo = await open()
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
  ['꺼져 있으면', settings({ enabled: false }), [record()], '켜고 저장'],
  ['열린 게시판이 없으면', settings(), [record({ status: 'published', publishedEpisodeNumber: 4 })], '열린 의견 게시판이 없어요'],
])('%s 지금 마감·실행이 잠기고 이유를 알린다', async (_name, saved, rows, why) => {
  await open(fakeRepo(saved, rows))
  expect((run() as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText(new RegExp(why)).id).toBe(run().getAttribute('aria-describedby'))
})

it('실행 요청이 409로 거절되면 코드별 문구를 경고로 알린다', async () => {
  const repo = fakeRepo()
  repo.run.mockRejectedValueOnce(new Error(SERIAL_ERROR_MESSAGES.SERIAL_RUNNING))
  await open(repo)
  fireEvent.click(run())
  expect((await screen.findByRole('alert')).textContent).toContain(SERIAL_ERROR_MESSAGES.SERIAL_RUNNING)
})

it('설정을 읽지 못하면 입력 칸 대신 실패와 다시 불러오기를 보인다 (빈 설정으로 채우지 않는다)', async () => {
  const repo = fakeRepo()
  repo.settings.mockRejectedValueOnce(new Error('설정 서버 오류'))
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(repo)} />)
  expect((await screen.findByRole('alert')).textContent).toContain('설정 서버 오류')
  expect(screen.queryByRole('checkbox', { name: 'AI 집필 켜기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  expect(await screen.findByRole('checkbox', { name: 'AI 집필 켜기' })).toBeTruthy()
})

it('기록만 읽지 못하면 설정은 그대로 두고 기록 실패와 새로 고침을 보인다', async () => {
  const repo = fakeRepo()
  repo.boards.mockRejectedValueOnce(new Error('기록 서버 오류'))
  render(<AiSerialPanel workId='w1' useCase={new SerialUseCase(repo)} />)
  await screen.findByRole('checkbox', { name: 'AI 집필 켜기' })
  expect((await screen.findByRole('alert')).textContent).toContain('기록 서버 오류')
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '기록 새로 고침' }))
  expect(await screen.findByRole('table')).toBeTruthy()
})
