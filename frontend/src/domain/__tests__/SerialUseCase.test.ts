import { describe, expect, it } from 'vitest'

import { seedWorks } from '../../data/mock/seed'
import {
  BEATS_MAX, BEAT_MAX, PREMISE_MAX, PROPOSAL_BODY_MAX, PROPOSAL_TITLE_MAX, SERIAL_DIRECTION_MAX,
  SERIAL_LOCK_NOTICE, canHideProposals, proposalInputError, proposalRequest, serialEpisodeLocked, serialNewEpisodeLocked, serialRunBlock, serialRunning, serialSettingsError, serialSettingsInput, sortProposals,
} from '../entities/aiSerial'
import { SerialUseCase } from '../usecases/SerialUseCase'
import { board, fakeSerialRepo, proposal, record, settings } from '../../test/serialFixtures'

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

  it('요청 본문은 요일·시각·방향만 보내고 방향의 앞뒤 공백을 지운다 (켜짐은 집필 방식이 정하므로 보내지 않는다, 요일 순서는 서버가 월~일로 저장한다)', () => {
    expect(serialSettingsInput(settings({ days: ['SUN', 'MON'], direction: '  따뜻하게\n ' })))
      .toEqual({ days: ['SUN', 'MON'], time: '21:00', direction: '따뜻하게' })
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

  it('꺼져 있으면 운영 설정의 집필 방식에서 AI 자율 집필을 고르라고 알린다', () => {
    expect(serialRunBlock(settings({ enabled: false }), [record()])).toBe('운영 설정 > 집필 방식에서 AI 자율 집필을 고르면 실행할 수 있어요.')
  })

  it('이미 대기·실행 중이면 막고, 열린 게시판이 없으면 게시판이 열리는 조건을 알린다', () => {
    expect(serialRunBlock(on, [record({ status: 'queued' })])).toContain('이미 실행 중')
    expect(serialRunBlock(on, [record({ status: 'running' }), record({ id: 'b0', status: 'published' })])).toContain('이미 실행 중')
    expect(serialRunBlock(on, [])).toContain('1화')
    expect(serialRunBlock(on, [record({ status: 'published' }), record({ id: 'b0', status: 'failed' })])).toContain('열린 게시판이 없어요')
  })

  it('켜져 있고 열린 게시판이 있으면 막지 않는다', () => {
    expect(serialRunBlock(on, [record({ status: 'open' }), record({ id: 'b0', status: 'failed' })])).toBeNull()
  })
})

describe('AI 자율 집필 중 원고 잠금', () => {
  it('집필실과 작품 관리가 서버의 SERIAL_LOCKED와 같은 계약 문장을 쓴다', () => {
    expect(SERIAL_LOCK_NOTICE).toBe('AI 자율 집필 중에는 1화만 직접 쓸 수 있어요. 운영 설정 > 집필 방식을 바꾸면 모든 회차를 쓸 수 있어요.')
  })

  it('대기·실행 중인 게시판이 있을 때만 실행 중이다 (기록을 읽지 못했으면 실행 중으로 보지 않는다)', () => {
    expect(serialRunning([record({ status: 'queued' })])).toBe(true)
    expect(serialRunning([record({ status: 'open' }), record({ id: 'b0', status: 'running' })])).toBe(true)
    for (const status of ['open', 'published', 'failed'] as const) expect(serialRunning([record({ status })]), status).toBe(false)
    expect(serialRunning([])).toBe(false)
    expect(serialRunning(undefined)).toBe(false)
  })

  it('AI 자율 집필 중에는 1화만 직접 쓸 수 있다 (꺼져 있거나 회차를 아직 못 골랐으면 잠그지 않는다)', () => {
    expect(serialEpisodeLocked(true, 1)).toBe(false)
    for (const number of [2, 3, 10]) expect(serialEpisodeLocked(true, number), String(number)).toBe(true)
    expect(serialEpisodeLocked(true, undefined)).toBe(false)
    for (const number of [1, 2, undefined]) expect(serialEpisodeLocked(false, number), String(number)).toBe(false)
  })

  it('새 회차는 활성 회차가 하나도 없을 때(1화 만들기)만 만든다 (꺼져 있거나 회차 수를 아직 못 읽었으면 잠그지 않는다)', () => {
    expect(serialNewEpisodeLocked(true, 0)).toBe(false)
    for (const count of [1, 5]) expect(serialNewEpisodeLocked(true, count), String(count)).toBe(true)
    expect(serialNewEpisodeLocked(true, undefined)).toBe(false)
    expect(serialNewEpisodeLocked(false, 3)).toBe(false)
  })
})

describe('제안 글 입력 규칙', () => {
  const ok = { title: '편지를 읽는 장면', body: '다음엔 주인공이 편지를 열어 보면 좋겠어요.' }
  it('제목은 공백을 뺀 1~100자, 내용은 공백을 뺀 1~2,000자다 (일반·시뮬레이션 모두)', () => {
    expect(proposalInputError({ kind: 'general', ...ok })).toBeNull()
    expect(proposalInputError({ kind: 'general', title: ' \n', body: ok.body })).toContain('제목')
    expect(proposalInputError({ kind: 'general', title: ' ' + '가'.repeat(PROPOSAL_TITLE_MAX) + ' ', body: ok.body })).toBeNull()
    expect(proposalInputError({ kind: 'general', title: '가'.repeat(PROPOSAL_TITLE_MAX + 1), body: ok.body })).toContain('100자')
    expect(proposalInputError({ kind: 'general', title: ok.title, body: '  ' })).toContain('내용')
    expect(proposalInputError({ kind: 'general', title: ok.title, body: ' ' + '가'.repeat(PROPOSAL_BODY_MAX) + ' ' })).toBeNull()
    expect(proposalInputError({ kind: 'general', title: ok.title, body: '가'.repeat(PROPOSAL_BODY_MAX + 1) })).toContain('2,000자')
    // 시뮬레이션도 제목·내용은 같은 규칙이다(전제·비트는 그 위에 더한다).
    expect(proposalInputError({ kind: 'simulation', title: '', body: ok.body, premise: '전제', beats: [] })).toContain('제목')
    expect(proposalInputError({ kind: 'simulation', title: ok.title, body: '', premise: '전제', beats: [] })).toContain('내용')
  })

  it('시뮬레이션은 전제 1~500자, 비트는 빈 줄을 뺀 5개 이하·각 200자 이하다 (비트는 없어도 된다)', () => {
    const premise = '주인공이 편지를 읽었다면'
    const sim = (extra: { premise?: string; beats?: string[] }) => proposalInputError({ kind: 'simulation', ...ok, premise, beats: [], ...extra })
    expect(sim({ premise: '  ' })).toContain('전제')
    expect(sim({ premise: '가'.repeat(PREMISE_MAX + 1) })).toContain('500자')
    expect(sim({})).toBeNull()
    expect(sim({ beats: Array.from({ length: BEATS_MAX }, (_, i) => '비트 ' + i) })).toBeNull()
    expect(sim({ beats: Array.from({ length: BEATS_MAX + 1 }, (_, i) => '비트 ' + i) })).toContain('5개')
    expect(sim({ beats: ['가'.repeat(BEAT_MAX + 1)] })).toContain('200자')
    expect(sim({ beats: ['', ' ', '하나', '  '] })).toBeNull()
  })

  it('요청 본문: 제목·내용의 앞뒤 공백을 지우고, 시뮬레이션은 전제·비트(빈 비트 제외)를 simulation에 싣는다', () => {
    expect(proposalRequest({ kind: 'general', title: ' 반전 제안 ', body: '  다음엔 반전이 좋겠어요 \n' })).toEqual({ kind: 'general', title: '반전 제안', body: '다음엔 반전이 좋겠어요' })
    expect(proposalRequest({ kind: 'simulation', title: ' 편지 장면 ', body: ' 읽는 장면 ', premise: ' 편지를 읽었다면 ', beats: [' 첫 비트 ', '', '  ', '둘째'] }))
      .toEqual({ kind: 'simulation', title: '편지 장면', body: '읽는 장면', simulation: { premise: '편지를 읽었다면', beats: ['첫 비트', '둘째'] } })
  })
})

describe('제안 글 정렬', () => {
  const at = (hour: number) => `2026-11-22T0${hour}:00:00Z`
  const posts = [proposal({ id: 'a', likes: 1, createdAt: at(1) }), proposal({ id: 'b', likes: 5, createdAt: at(2) }), proposal({ id: 'c', likes: 5, createdAt: at(3) }), proposal({ id: 'd', likes: 0, createdAt: at(4) })]
  it('최신순은 작성 시각이 늦은 글부터이고, 추천순은 추천이 많은 글부터이며 같으면 먼저 쓴 글이 앞이다 (AI가 읽는 추천 상위 글의 동률 규칙과 같다)', () => {
    expect(sortProposals(posts, 'new').map((p) => p.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(sortProposals(posts, 'likes').map((p) => p.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('시각 표기(오프셋)가 달라도 실제 시각으로 견주고, 받은 목록은 바꾸지 않는다', () => {
    // x는 01:00Z, y는 05:00Z라 실제로는 y가 늦다(글자로만 견주면 '10:00'이 '05:00'보다 커서 x가 앞선다).
    const mixed = [proposal({ id: 'x', createdAt: '2026-11-22T10:00:00+09:00' }), proposal({ id: 'y', createdAt: '2026-11-22T05:00:00Z' })]
    expect(sortProposals(mixed, 'new').map((p) => p.id)).toEqual(['y', 'x'])
    const before = posts.map((p) => p.id)
    sortProposals(posts, 'likes')
    expect(posts.map((p) => p.id)).toEqual(before)
  })
})

describe('제안 글 숨김 권한 표시 (서버가 다시 확인한다)', () => {
  const works = seedWorks(0)
  const mine = works.find((w) => w.id === 'starlight')!
  const others = works.find((w) => w.id === 'postman')!
  const server = { ...others, canonical: true, owner: 'member-1', mine: false }

  it('소유자만 열린다 (운영자도 아니다)', () => {
    expect(canHideProposals(mine, null)).toBe(true)
    expect(canHideProposals(others, 'member-9')).toBe(false)
    expect(canHideProposals(server, 'member-1')).toBe(true)
    expect(canHideProposals(server, 'member-2')).toBe(false)
    expect(canHideProposals(server, null)).toBe(false)
    expect(canHideProposals({ ...server, owner: undefined }, null)).toBe(false)
  })
})

describe('AI 자율 연재 UseCase', () => {
  it('설정 저장은 검증하고 요일·시각·방향만 다듬어 보내고 그 값을 돌려준다 (서버 값 다시 읽기는 호출 측이 따로 한다)', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    const saved = await useCase.saveSettings('w1', settings({ days: ['SUN', 'MON'], direction: ' 입력 ' }), signal)
    expect(repo.saveSettings).toHaveBeenCalledWith('w1', { days: ['SUN', 'MON'], time: '21:00', direction: '입력' }, signal)
    expect(saved).toEqual({ days: ['SUN', 'MON'], time: '21:00', direction: '입력' })
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

  it('제안 글 제출은 검증한 요청 본문을 보낸다', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    await useCase.submitProposal('w1', { kind: 'simulation', title: ' 제목 ', body: ' 내용 ', premise: ' 전제 ', beats: ['비트', ''] }, signal)
    expect(repo.submitProposal).toHaveBeenCalledWith('w1', { kind: 'simulation', title: '제목', body: '내용', simulation: { premise: '전제', beats: ['비트'] } }, signal)
  })

  it('제안 글이 규칙을 어기면 저장소를 부르지 않는다', async () => {
    const { repo, useCase } = setup()
    await expect(useCase.submitProposal('w1', { kind: 'general', title: '  ', body: '내용' })).rejects.toThrow('제목')
    await expect(useCase.submitProposal('w1', { kind: 'simulation', title: '제목', body: '내용', premise: '', beats: [] })).rejects.toThrow('전제')
    untouched(repo)
  })

  it('읽기·실행·투표·추천·숨김은 저장소에 그대로 넘긴다', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    expect(await useCase.settings('w1', signal)).toEqual(settings())
    expect(await useCase.boards('w1', signal)).toEqual([record()])
    expect(await useCase.board('w1', signal)).toEqual(board())
    await useCase.run('w1', signal)
    await useCase.vote('w1', 'c2', signal)
    await useCase.cancelVote('w1', signal)
    await useCase.likeProposal('w1', 'p1', signal)
    await useCase.unlikeProposal('w1', 'p1', signal)
    await useCase.hideProposal('w1', 'p2', signal)
    expect(repo.settings).toHaveBeenCalledWith('w1', signal)
    expect(repo.boards).toHaveBeenCalledWith('w1', signal)
    expect(repo.board).toHaveBeenCalledWith('w1', signal)
    expect(repo.run).toHaveBeenCalledWith('w1', signal)
    expect(repo.vote).toHaveBeenCalledWith('w1', 'c2', signal)
    expect(repo.cancelVote).toHaveBeenCalledWith('w1', signal)
    expect(repo.likeProposal).toHaveBeenCalledWith('w1', 'p1', signal)
    expect(repo.unlikeProposal).toHaveBeenCalledWith('w1', 'p1', signal)
    expect(repo.hideProposal).toHaveBeenCalledWith('w1', 'p2', signal)
  })
})
