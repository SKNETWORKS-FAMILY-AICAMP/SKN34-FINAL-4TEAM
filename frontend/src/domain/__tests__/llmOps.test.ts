import { describe, expect, it } from 'vitest'

import { bodyText, percent, periodRange, promoteLabel, usd, type PromptVersion } from '../entities/llmOps'
import { JOB_RUNS_LIMIT, jobKindLabel, jobProgress, jobStatusLabel } from '../entities/jobMonitor'
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

  it('production보다 새 버전은 승격, 오래된 버전은 복원, production 자신은 버튼이 없다', () => {
    const v = (version: number, labels: string[] = []): PromptVersion => ({ version, labels, createdAt: '2026-11-19T00:00:00Z' })
    const versions = [v(3), v(2, ['production']), v(1)]
    expect(promoteLabel(versions, versions[0])).toBe('승격')
    expect(promoteLabel(versions, versions[2])).toBe('복원')
    expect(promoteLabel(versions, versions[1])).toBeNull()
    // production 라벨이 아직 없으면 어느 버전이든 승격이다.
    expect(promoteLabel([v(1)], v(1))).toBe('승격')
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

  it('진행률은 done/total과 백분율이고, 전체를 모르면 완료 수만 보인다', () => {
    expect(jobProgress({ done: 3, total: 12 })).toBe('3/12 (25%)')
    expect(jobProgress({ done: 5, total: 0 })).toBe('5건')
    expect(jobProgress(null)).toBe('—')
    expect(jobProgress(undefined)).toBe('—')
  })
})
