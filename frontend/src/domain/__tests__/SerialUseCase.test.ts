import { describe, expect, it } from 'vitest'

import { seedWorks } from '../../data/mock/seed'
import {
  BEATS_MAX, BEAT_MAX, OPINION_BODY_MAX, PREMISE_MAX, SERIAL_DIRECTION_MAX,
  SERIAL_LOCK_NOTICE, canHideOpinions, opinionInputError, opinionRequest, serialOffBlock, serialRunBlock, serialRunning, serialSettingsError, serialSettingsInput,
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
  it('설정·기록을 읽는 중이면 그렇게, 읽지 못했으면 실패로 이유를 알린다', () => {
    expect(serialRunBlock(undefined, [record()])).toContain('불러오는 중')
    expect(serialRunBlock(on, undefined)).toContain('불러오는 중')
    // 읽기에 실패했는데 '불러오는 중'이라고 하면 기다려도 풀리지 않는 것을 숨기게 된다.
    for (const block of [serialRunBlock(undefined, [record()], true), serialRunBlock(on, undefined, true)]) {
      expect(block).toContain('불러오지 못')
      expect(block).not.toContain('불러오는 중')
    }
    // 둘 다 읽어 둔 뒤에는 읽기 실패 표시가 막는 규칙을 바꾸지 않는다.
    expect(serialRunBlock(on, [record()], true)).toBeNull()
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

describe('AI 집필 중 원고 잠금', () => {
  const on = settings()
  it('집필실과 작품 관리가 같은 안내 문장을 쓴다', () => {
    expect(SERIAL_LOCK_NOTICE).toBe('AI 집필 중이라 원고를 수정할 수 없어요. 작품 관리 > AI 집필에서 끄면 수정할 수 있어요.')
  })

  it('대기·실행 중인 게시판이 있을 때만 실행 중이다 (기록을 읽지 못했으면 실행 중으로 보지 않는다)', () => {
    expect(serialRunning([record({ status: 'queued' })])).toBe(true)
    expect(serialRunning([record({ status: 'open' }), record({ id: 'b0', status: 'running' })])).toBe(true)
    for (const status of ['open', 'published', 'failed'] as const) expect(serialRunning([record({ status })]), status).toBe(false)
    expect(serialRunning([])).toBe(false)
    expect(serialRunning(undefined)).toBe(false)
  })

  it('켜 둔 설정은 게시판이 대기·실행 중인 동안 끌 수 없다고 알린다 (서버가 끄는 저장을 409 SERIAL_RUNNING으로 거절하는 조건과 같다)', () => {
    for (const status of ['queued', 'running'] as const) expect(serialOffBlock(on, [record({ status })]), status).toContain('끌 수 없어요')
    expect(serialOffBlock(on, [record({ status: 'open' }), record({ id: 'b0', status: 'published' })])).toBeNull()
  })

  it('이미 꺼져 있거나 아직 읽지 못했으면 막지 않는다 (판정은 서버 409가 한다)', () => {
    expect(serialOffBlock(settings({ enabled: false }), [record({ status: 'running' })])).toBeNull()
    expect(serialOffBlock(undefined, [record({ status: 'running' })])).toBeNull()
    expect(serialOffBlock(on, undefined)).toBeNull()
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
  it('설정 저장은 검증하고 다듬은 값을 보내고 그 값을 돌려준다 (서버 값 다시 읽기는 호출 측이 따로 한다)', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    const saved = await useCase.saveSettings('w1', settings({ days: ['SUN', 'MON'], direction: ' 입력 ' }), signal)
    expect(repo.saveSettings).toHaveBeenCalledWith('w1', settings({ days: ['SUN', 'MON'], direction: '입력' }), signal)
    expect(saved).toEqual(settings({ days: ['SUN', 'MON'], direction: '입력' }))
    // 저장(PUT)이 끝난 뒤 읽기가 실패해도 저장 실패로 보이지 않게 저장은 읽지 않는다.
    expect(repo.settings).not.toHaveBeenCalled()
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

  it('저장 요청이 거절되면 그 실패를 그대로 던진다', async () => {
    const { repo, useCase } = setup()
    repo.saveSettings.mockRejectedValue(new Error('서버 거절'))
    await expect(useCase.saveSettings('w1', settings())).rejects.toThrow('서버 거절')
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
