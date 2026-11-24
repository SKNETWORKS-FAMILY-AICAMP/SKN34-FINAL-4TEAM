import { describe, expect, it } from 'vitest'

import {
  LLM_FORBIDDEN, bodyText, estimatedCalls, fixedModel, isOptimizable, itemReason, itemWaiting, labelText, modelLabel, pendingSeed, percent, periodRange, productionOf, usd, versionAction, type EvaluationItem, type PromptVersion,
} from '../entities/llmOps'
import { JOBS_FORBIDDEN, JOB_KINDS, JOB_RUNS_LIMIT, jobKindLabel, jobProgress, jobRetryable, jobSourceLabel, jobStatusLabel, type JobRun } from '../entities/jobMonitor'
import { lastPage } from '../entities/operations'

describe('LLMOps 표시 값', () => {
  it('비율은 백분율로, 데이터가 없으면 0%가 아니라 데이터 없음이다', () => {
    expect(percent(0.0123)).toBe('1.2%')
    expect(percent(0.5)).toBe('50%')
    expect(percent(0)).toBe('0%')
    expect(percent(null)).toBe('데이터 없음')
    expect(percent(undefined)).toBe('데이터 없음')
  })

  it('비용은 USD 네 자리, 없으면 대시다', () => {
    expect(usd(0.0123)).toBe('$0.0123')
    expect(usd(12)).toBe('$12.0000')
    expect(usd(null)).toBe('—')
  })

  it('조회 기간은 지금부터 거꾸로 센 UTC 구간이다', () => {
    const now = new Date('2026-11-19T03:00:00Z')
    expect(periodRange(24, now)).toEqual({ from: '2026-11-18T03:00:00.000Z', to: '2026-11-19T03:00:00.000Z' })
    expect(periodRange(24 * 7, now).from).toBe('2026-11-12T03:00:00.000Z')
  })

  it('추적 입력·출력은 문자열이면 그대로, 객체면 들여쓴 JSON, 없으면 빈 글이다', () => {
    expect(bodyText('질문')).toBe('질문')
    expect(bodyText({ q: 1 })).toBe('{\n  "q": 1\n}')
    expect(bodyText(undefined)).toBe('')
    expect(bodyText(null)).toBe('')
  })

  it('버전의 조치: 서비스에 반영 중이면 없음, 자기 후보 라벨이 있으면 반영, 아니면 후보 등록이다(#705)', () => {
    const v = (version: number, labels: string[] = []): PromptVersion => ({ version, labels })
    expect(versionAction(v(3, ['production', 'candidate-3']))).toBe('live')
    expect(versionAction(v(3, ['candidate-3', 'latest']))).toBe('promote')
    // 다른 버전의 후보 라벨이나 번호 없는 라벨은 이 버전의 후보가 아니다.
    expect([versionAction(v(3, ['candidate-2'])), versionAction(v(3, ['candidate'])), versionAction(v(3))]).toEqual(['candidate', 'candidate', 'candidate'])
  })

  it('라벨은 화면 이름으로 보이고 Langfuse가 관리하는 latest는 숨긴다', () => {
    expect(['production', 'candidate-3', 'seed', 'latest', 'staging'].map(labelText)).toEqual(['서비스 반영 중', '후보', '코드 시드', null, 'staging'])
  })
})

describe('쪽 이동 범위', () => {
  it('마지막 쪽은 0부터 세고, 합계가 0이어도 첫 쪽이다', () => {
    expect(lastPage(45, 20)).toBe(2)
    expect(lastPage(40, 20)).toBe(1)
    expect(lastPage(0, 20)).toBe(0)
  })

  it('서버가 앞에서부터 1,000건까지만 읽게 하면 그 안의 쪽까지만 열 수 있다(넘는 쪽은 400)', () => {
    expect(JOB_RUNS_LIMIT).toBe(1000)
    expect(lastPage(5000, 20, JOB_RUNS_LIMIT)).toBe(49)
    expect(lastPage(1000, 20, JOB_RUNS_LIMIT)).toBe(49)
    // 크기 30이면 33쪽(0부터)은 34*30=1,020이라 넘으므로 마지막은 32쪽이다.
    expect(lastPage(5000, 30, JOB_RUNS_LIMIT)).toBe(32)
    expect(lastPage(15, 20, JOB_RUNS_LIMIT)).toBe(0)
  })
})

describe('작업 감시 표시 값', () => {
  it('종류·상태는 한국어로, 모르는 값은 그대로 보인다', () => {
    expect(jobKindLabel('regression_eval')).toBe('회귀 평가')
    expect(jobKindLabel('manuscript_preprocessing')).toBe('manuscript_preprocessing')
    expect(jobStatusLabel('failed')).toBe('실패')
    expect(jobStatusLabel('constructor')).toBe('constructor')
  })

  it('회귀 평가 실행은 종류 회귀 평가·출처 AI 평가로 보이고, 일정으로 등록하는 종류 목록에는 없다', () => {
    expect(jobKindLabel('evaluation')).toBe('회귀 평가')
    expect(jobSourceLabel('ai-evaluation')).toBe('AI 평가')
    expect(jobSourceLabel('content-preprocessing')).toBe('원고 전처리')
    expect(jobSourceLabel('constructor')).toBe('constructor')
    // 일정은 handler가 있는 종류만 받으므로 평가 실행 종류가 일정 폼의 선택지로 새면 안 된다.
    expect(JOB_KINDS.map(([kind]) => kind)).not.toContain('evaluation')
  })

  it('실패한 기록만 다시 실행할 수 있고, 평가 실행은 평가 화면에서 새로 실행하므로 실패해도 제외한다', () => {
    const run = (status: string, source: string, kind = 'x'): JobRun => ({ id: 'r', kind, source, status, trigger: 'manual' })
    expect(jobRetryable(run('failed', 'operations-scheduler'))).toBe(true)
    expect(jobRetryable(run('failed', 'content-preprocessing', 'preprocessing'))).toBe(true)
    expect(jobRetryable(run('failed', 'ai-evaluation', 'evaluation'))).toBe(false)
    for (const status of ['queued', 'running', 'succeeded', 'cancelled']) expect(jobRetryable(run(status, 'operations-scheduler'))).toBe(false)
  })

  it('진행률은 done/total과 백분율이고, 전체를 모르면 완료 수만 보인다', () => {
    expect(jobProgress({ done: 3, total: 12 })).toBe('3/12 (25%)')
    expect(jobProgress({ done: 5, total: 0 })).toBe('5건')
    expect(jobProgress(null)).toBe('—')
    expect(jobProgress(undefined)).toBe('—')
  })
})

describe('권한 안내 문구', () => {
  it('조회가 403이면 다시 불러오기 대신 필요한 권한을 안내한다', () => {
    expect(LLM_FORBIDDEN).toBe('LLM Ops 조회 권한이 있어야 볼 수 있어요.')
    expect(JOBS_FORBIDDEN).toBe("실행 기록과 일정을 보려면 '정기 작업' 권한이 필요해요.")
  })

  it('production 버전과, production과 다른 코드 시드(seed 라벨) 버전을 찾는다(#705)', () => {
    const v = (version: number, labels: string[] = []): PromptVersion => ({ version, labels })
    expect(productionOf({ name: 'p', candidates: 0, versions: [v(3, ['seed']), v(2, ['production'])] })?.version).toBe(2)
    expect(pendingSeed({ name: 'p', candidates: 0, versions: [v(3, ['seed', 'latest']), v(2, ['production'])] })?.version).toBe(3)
    // 시드가 production과 같은 버전이거나 아직 seed 라벨이 없으면 대기 중인 시드가 없다.
    expect(pendingSeed({ name: 'p', candidates: 0, versions: [v(2, ['production', 'seed'])] })).toBeNull()
    expect(pendingSeed({ name: 'p', candidates: 0, versions: [v(2, ['production'])] })).toBeNull()
    expect(productionOf({ name: 'p', candidates: 0, versions: [v(1)] })).toBeNull()
  })

  it('버전에 고른 모델이 없으면 기본 모델(환경 설정)로 보이고, Decisions API 프롬프트는 모델을 고를 수 없다', () => {
    // 고르지 않은 버전의 실제 모델은 AI 서비스 환경 변수라 이름을 단정하지 않는다(#808).
    expect([modelLabel('gpt-x'), modelLabel(null), modelLabel(undefined)]).toEqual(['gpt-x', '기본 모델(환경 설정)', '기본 모델(환경 설정)'])
    expect([fixedModel('decision_guard.judge'), fixedModel('character_simulation.direct'), fixedModel('orchestration.main')]).toEqual([true, true, false])
  })
})

describe('프롬프트 자동 개선 표시 값(#823)', () => {
  it('자동 개선은 인물 시뮬레이션 대사·나레이션 프롬프트만 켠다', () => {
    expect([isOptimizable('character_simulation.act'), isOptimizable('character_simulation.narrate')]).toEqual([true, true])
    // 같은 접두어의 다른 호출·다른 기능·객체 기본 속성 이름은 켜지지 않는다.
    expect(['character_simulation.direct', 'character_simulation.check', 'story_context.answer', 'toString', ''].map(isOptimizable)).toEqual([false, false, false, false, false])
  })

  it('예상 OpenAI 호출 수 어림은 2 × 평가 호출 상한 + 2 × 게이트 세트 문항 수다', () => {
    expect(estimatedCalls('character_simulation.act', 150)).toBe(2 * 150 + 2 * 24)
    expect(estimatedCalls('character_simulation.narrate', 150)).toBe(2 * 150 + 2 * 46)
    expect(estimatedCalls('character_simulation.act', 500)).toBe(1048)
    expect(estimatedCalls('character_simulation.act', 1)).toBe(50)
  })

  it('실패한 문항의 이유: 항목 오류는 서버 문구, 시점 위반과 0.5 미만 지표는 이름으로, 통과한 문항은 이유가 없다', () => {
    const item = (over: Partial<EvaluationItem>): EvaluationItem => ({ itemId: 'simulation.act-01', scores: { voice: 0.75, intent: 1, pov_ok: 1 }, failed: false, ...over })
    expect(itemReason(item({}))).toBeNull()
    expect(itemReason(item({ failed: true, scores: {}, error: '생성 또는 채점에 실패했어요.' }))).toBe('생성 또는 채점에 실패했어요.')
    expect(itemReason(item({ failed: true, scores: { voice: 1, intent: 1, pov_ok: 0 } }))).toBe('시점 위반(위반 사실 있음)')
    expect(itemReason(item({ failed: true, scores: { voice: 0.25, intent: 0.4, pov_ok: 1 } }))).toBe('0.5 미만 지표: voice, intent')
    expect(itemReason(item({ failed: true, scores: { voice: 0.25, intent: 1, pov_ok: 0 } }))).toBe('시점 위반(위반 사실 있음) · 0.5 미만 지표: voice')
    // 서버가 실패로 센 이유를 이 규칙으로 찾지 못해도 이유 칸이 비지 않는다.
    expect(itemReason(item({ failed: true }))).toBe('실패')
  })
})

describe('문항별 결과의 진행 중 표시(#823)', () => {
  it('점수가 아직 없고 실패도 아닌 문항은 진행 중이다', () => {
    const item = (over: Partial<EvaluationItem>): EvaluationItem => ({ itemId: 'simulation.act-01', scores: {}, failed: false, ...over })
    expect(itemWaiting(item({}))).toBe(true)
    // 점수가 있으면 끝난 문항이고, 실패(항목 오류)한 문항은 진행 중이 아니다.
    expect([itemWaiting(item({ scores: { voice: 0.5 } })), itemWaiting(item({ failed: true, error: '생성 또는 채점에 실패했어요.' }))]).toEqual([false, false])
  })
})
