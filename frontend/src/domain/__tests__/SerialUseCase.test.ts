import { describe, expect, it } from 'vitest'

import { seedWorks } from '../../data/mock/seed'
import {
  BEATS_MAX, BEAT_MAX, OPINION_BODY_MAX, PREMISE_MAX, SERIAL_DIRECTION_MAX, SERIAL_ERROR_MESSAGES,
  canHideOpinions, opinionInputError, opinionRequest, serialRunBlock, serialSettingsError, serialSettingsInput,
} from '../entities/aiSerial'
import { SerialUseCase } from '../usecases/SerialUseCase'
import { board, fakeSerialRepo, record, settings } from '../../test/serialFixtures'

const setup = () => {
  const repo = fakeSerialRepo()
  return { repo, useCase: new SerialUseCase(repo) }
}
const untouched = (repo: ReturnType<typeof setup>['repo']) => Object.values(repo).forEach((fn) => expect(fn).not.toHaveBeenCalled())

describe('AI 집필 설정 규칙', () => {
  it('요일은 하나 이상, 시각은 HH:mm, 방향은 공백을 뺀 2,000자까지다', () => {
    expect(serialSettingsError(settings())).toBeNull()
    expect(serialSettingsError(settings({ days: [] }))).toContain('요일')
    // 끄는 저장은 요일이 비어도 된다(서버 규칙과 같다). 켜려면 요일이 하나 이상 있어야 한다.
    expect(serialSettingsError(settings({ enabled: false, days: [] }))).toBeNull()
    expect(serialSettingsError(settings({ enabled: false, days: [], time: '25:00' }))).toContain('시각')
    for (const time of ['', '9:00', '24:00', '21:60', '21:00:00', '밤 9시']) expect(serialSettingsError(settings({ time })), time).toContain('시각')
    expect(serialSettingsError(settings({ time: '00:00' }))).toBeNull()
    expect(serialSettingsError(settings({ time: '23:59' }))).toBeNull()
    expect(serialSettingsError(settings({ direction: ' ' + '가'.repeat(SERIAL_DIRECTION_MAX) + ' ' }))).toBeNull()
    expect(serialSettingsError(settings({ direction: '가'.repeat(SERIAL_DIRECTION_MAX + 1) }))).toContain('2,000자')
  })

  it('요청 본문은 방향의 앞뒤 공백을 지운다 (요일 순서는 서버가 월~일로 저장한다)', () => {
    expect(serialSettingsInput(settings({ days: ['SUN', 'MON'], direction: '  따뜻하게\n ' })))
      .toEqual({ enabled: true, days: ['SUN', 'MON'], time: '21:00', direction: '따뜻하게' })
  })
})

describe('지금 마감·실행 가능 여부', () => {
  const on = settings()
  it('설정·기록을 아직 읽지 못했으면 이유를 알린다', () => {
    expect(serialRunBlock(undefined, [record()])).toContain('불러오')
    // 막는 이유의 문구는 서버가 같은 조건에서 돌려주는 409 문구와 같다.
    expect(serialRunBlock(settings({ enabled: false }), [record()])).toBe(SERIAL_ERROR_MESSAGES.SERIAL_DISABLED)
    expect(serialRunBlock(on, [record({ status: 'running' })])).toBe(SERIAL_ERROR_MESSAGES.SERIAL_RUNNING)
    expect(serialRunBlock(on, [])).toBe(SERIAL_ERROR_MESSAGES.SERIAL_NO_BOARD)
    expect(serialRunBlock(on, undefined)).toContain('불러오')
  })

  it('꺼져 있으면 켜고 저장하라고 알린다 (켠 값을 저장하기 전의 화면 입력은 보지 않는다)', () => {
    expect(serialRunBlock(settings({ enabled: false }), [record()])).toContain('켜고 저장')
  })

  it('이미 대기·실행 중이면 막고, 열린 게시판이 없으면 게시판이 열리는 조건을 알린다', () => {
    expect(serialRunBlock(on, [record({ status: 'queued' })])).toContain('이미 실행 중')
    expect(serialRunBlock(on, [record({ status: 'running' }), record({ id: 'b0', status: 'published' })])).toContain('이미 실행 중')
    expect(serialRunBlock(on, [])).toContain('1화')
    expect(serialRunBlock(on, [record({ status: 'published' }), record({ id: 'b0', status: 'failed' })])).toContain('열린 의견 게시판이 없어요')
  })

  it('켜져 있고 열린 게시판이 있으면 막지 않는다', () => {
    expect(serialRunBlock(on, [record({ status: 'open' }), record({ id: 'b0', status: 'failed' })])).toBeNull()
  })
})

describe('서버 오류 코드별 문구', () => {
  it('계약의 409 코드마다 고정 한국어 문구가 있다', () => {
    for (const code of ['SERIAL_DISABLED', 'SERIAL_NO_BOARD', 'SERIAL_RUNNING', 'OPINION_EXISTS', 'INSUFFICIENT_CREDIT']) expect(SERIAL_ERROR_MESSAGES[code], code).toMatch(/[가-힣]/)
    expect(SERIAL_ERROR_MESSAGES.INSUFFICIENT_CREDIT).toContain('크레딧')
    expect(SERIAL_ERROR_MESSAGES.OPINION_EXISTS).toContain('이미')
    // 열린 게시판이 없다는 409는 소유자의 실행뿐 아니라 독자의 의견·투표에서도 와서, 독자에게도 어색하지 않은 말이다.
    expect(SERIAL_ERROR_MESSAGES.SERIAL_NO_BOARD).not.toContain('발행하면')
  })
})

describe('의견 입력 규칙', () => {
  it('일반 의견은 공백을 뺀 1~1,000자다', () => {
    expect(opinionInputError({ kind: 'general', body: ' \n' })).toContain('의견')
    expect(opinionInputError({ kind: 'general', body: ' ' + '가'.repeat(OPINION_BODY_MAX) + ' ' })).toBeNull()
    expect(opinionInputError({ kind: 'general', body: '가'.repeat(OPINION_BODY_MAX + 1) })).toContain('1,000자')
  })

  it('시뮬레이션은 전제 1~500자, 비트는 빈 줄을 뺀 5개 이하·각 200자 이하다 (비트는 없어도 된다)', () => {
    const premise = '주인공이 편지를 읽었다면'
    expect(opinionInputError({ kind: 'simulation', premise: '  ', beats: [] })).toContain('전제')
    expect(opinionInputError({ kind: 'simulation', premise: '가'.repeat(PREMISE_MAX + 1), beats: [] })).toContain('500자')
    expect(opinionInputError({ kind: 'simulation', premise, beats: [] })).toBeNull()
    expect(opinionInputError({ kind: 'simulation', premise, beats: Array.from({ length: BEATS_MAX }, (_, i) => '비트 ' + i) })).toBeNull()
    expect(opinionInputError({ kind: 'simulation', premise, beats: Array.from({ length: BEATS_MAX + 1 }, (_, i) => '비트 ' + i) })).toContain('5개')
    expect(opinionInputError({ kind: 'simulation', premise, beats: ['가'.repeat(BEAT_MAX + 1)] })).toContain('200자')
    expect(opinionInputError({ kind: 'simulation', premise, beats: ['', ' ', '하나', '  '] })).toBeNull()
  })

  it('요청 본문: 일반은 {kind, body}, 시뮬레이션은 body(선택 코멘트)를 비우고 빈 비트를 뺀다', () => {
    expect(opinionRequest({ kind: 'general', body: '  다음엔 반전이 좋겠어요 \n' })).toEqual({ kind: 'general', body: '다음엔 반전이 좋겠어요' })
    expect(opinionRequest({ kind: 'simulation', premise: ' 편지를 읽었다면 ', beats: [' 첫 비트 ', '', '  ', '둘째'] }))
      .toEqual({ kind: 'simulation', body: '', simulation: { premise: '편지를 읽었다면', beats: ['첫 비트', '둘째'] } })
  })
})

describe('의견 숨김 권한 표시 (서버가 다시 확인한다)', () => {
  const works = seedWorks(0)
  const mine = works.find((w) => w.id === 'starlight')!
  const others = works.find((w) => w.id === 'postman')!
  const server = { ...others, canonical: true, owner: 'member-1', mine: false }

  it('소유자만 열린다 (운영자도 아니다)', () => {
    expect(canHideOpinions(mine, null)).toBe(true)
    expect(canHideOpinions(others, 'member-9')).toBe(false)
    expect(canHideOpinions(server, 'member-1')).toBe(true)
    expect(canHideOpinions(server, 'member-2')).toBe(false)
    expect(canHideOpinions(server, null)).toBe(false)
    expect(canHideOpinions({ ...server, owner: undefined }, null)).toBe(false)
  })
})

describe('AI 자율 연재 UseCase', () => {
  it('설정 저장은 검증하고 다듬은 값을 보내고 서버가 저장한 값을 다시 읽어 돌려준다', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    repo.settings.mockResolvedValue(settings({ days: ['MON', 'SUN'], direction: '서버 값' }))
    const saved = await useCase.saveSettings('w1', settings({ days: ['SUN', 'MON'], direction: ' 입력 ' }), signal)
    expect(repo.saveSettings).toHaveBeenCalledWith('w1', settings({ days: ['SUN', 'MON'], direction: '입력' }), signal)
    expect(repo.settings).toHaveBeenCalledWith('w1', signal)
    expect(saved).toEqual(settings({ days: ['MON', 'SUN'], direction: '서버 값' }))
    expect(repo.saveSettings.mock.invocationCallOrder[0]).toBeLessThan(repo.settings.mock.invocationCallOrder[0])
  })

  it.each([
    ['요일 없음', { days: [] }, '요일'],
    ['잘못된 시각', { time: '25:00' }, '시각'],
    ['긴 방향', { direction: '가'.repeat(SERIAL_DIRECTION_MAX + 1) }, '2,000자'],
  ])('설정 저장은 입력이 규칙을 어기면 저장소를 부르지 않고 안내 문구로 거절한다 — %s', async (_name, extra, message) => {
    const { repo, useCase } = setup()
    await expect(useCase.saveSettings('w1', settings(extra))).rejects.toThrow(message)
    untouched(repo)
  })

  it('저장 요청이 실패하면 다시 읽지 않고 그 실패를 그대로 던진다', async () => {
    const { repo, useCase } = setup()
    repo.saveSettings.mockRejectedValue(new Error('서버 거절'))
    await expect(useCase.saveSettings('w1', settings())).rejects.toThrow('서버 거절')
    expect(repo.settings).not.toHaveBeenCalled()
  })

  it('의견 제출은 검증한 요청 본문을 보낸다', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    await useCase.submitOpinion('w1', { kind: 'simulation', premise: ' 전제 ', beats: ['비트', ''] }, signal)
    expect(repo.submitOpinion).toHaveBeenCalledWith('w1', { kind: 'simulation', body: '', simulation: { premise: '전제', beats: ['비트'] } }, signal)
  })

  it('의견이 규칙을 어기면 저장소를 부르지 않는다', async () => {
    const { repo, useCase } = setup()
    await expect(useCase.submitOpinion('w1', { kind: 'general', body: '   ' })).rejects.toThrow('의견')
    await expect(useCase.submitOpinion('w1', { kind: 'simulation', premise: '', beats: [] })).rejects.toThrow('전제')
    untouched(repo)
  })

  it('읽기·실행·투표·숨김은 저장소에 그대로 넘긴다', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    expect(await useCase.settings('w1', signal)).toEqual(settings())
    expect(await useCase.boards('w1', signal)).toEqual([record()])
    expect(await useCase.board('w1', signal)).toEqual(board())
    await useCase.run('w1', signal)
    await useCase.vote('w1', 'o1', signal)
    await useCase.cancelVote('w1', signal)
    await useCase.hideOpinion('w1', 'o2', signal)
    expect(repo.settings).toHaveBeenCalledWith('w1', signal)
    expect(repo.boards).toHaveBeenCalledWith('w1', signal)
    expect(repo.board).toHaveBeenCalledWith('w1', signal)
    expect(repo.run).toHaveBeenCalledWith('w1', signal)
    expect(repo.vote).toHaveBeenCalledWith('w1', 'o1', signal)
    expect(repo.cancelVote).toHaveBeenCalledWith('w1', signal)
    expect(repo.hideOpinion).toHaveBeenCalledWith('w1', 'o2', signal)
  })
})
