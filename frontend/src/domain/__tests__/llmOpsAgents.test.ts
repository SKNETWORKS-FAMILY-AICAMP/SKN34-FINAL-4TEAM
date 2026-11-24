import { describe, expect, it } from 'vitest'

import type { MetricRow } from '../entities/llmOps'
import { agentCards, agentLabel, latencyBarSummary, outcomeSummary } from '../entities/llmOpsAgents'

const row = (key: string, patch: Partial<MetricRow> = {}): MetricRow => ({
  key, requests: 100, failureRate: 0.1, timeoutRate: 0.02, p50LatencyMs: 1000, p95LatencyMs: 4000, inputTokens: 5000, outputTokens: 1200, costUser: 0.1, costPlatform: 0.4, ...patch,
})

describe('에이전트(기능) 이름', () => {
  it('AI 서비스가 trace에 다는 기능 키는 화면 이름으로, 모르는 키는 키 그대로 보이고 객체 기본 속성 이름이 새지 않는다', () => {
    expect(agentLabel('orchestration')).toBe('집필 AI 채팅')
    expect(agentLabel('manuscript_review')).toBe('원고 검수')
    expect(agentLabel('serial.episode')).toBe('AI 자율 연재')
    expect(['future_feature', 'toString', 'constructor'].map(agentLabel)).toEqual(['future_feature', 'toString', 'constructor'])
  })
})

describe('에이전트 지표 카드(#857)', () => {
  it('카드는 지표 API 기능 행마다 하나이고 요청이 많은 순(같으면 키순)이며, 전체 요청 중 비중을 가진다', () => {
    const cards = agentCards([row('b', { requests: 30 }), row('a', { requests: 30 }), row('orchestration', { requests: 140 })])
    expect(cards.map((c) => [c.key, c.label, c.share])).toEqual([['orchestration', '집필 AI 채팅', 0.7], ['a', 'a', 0.15], ['b', 'b', 0.15]])
    expect(agentCards([])).toEqual([])
    // 요청이 하나도 없으면 비중은 0이다(0으로 나누지 않는다).
    expect(agentCards([row('a', { requests: 0 })])[0].share).toBe(0)
  })

  it('카드는 지표 행의 숫자를 그대로 가지고 비어 온 값을 0으로 바꾸지 않는다', () => {
    const [card] = agentCards([row('rating', { failureRate: null, timeoutRate: null, p50LatencyMs: undefined, p95LatencyMs: null })])
    expect(card).toMatchObject({ key: 'rating', label: '심의 등급', requests: 100, failureRate: null, timeoutRate: null, p50LatencyMs: null, p95LatencyMs: null, inputTokens: 5000, outputTokens: 1200, costUser: 0.1, costPlatform: 0.4 })
    expect([card.outcome, card.latency]).toEqual([null, null])
  })

  it('처리 결과 막대는 요청 수에 실패율·시간 초과율을 곱한 건수와 나머지 성공으로 나뉘고, 합은 늘 요청 수와 같다', () => {
    expect(agentCards([row('a')])[0].outcome).toEqual({ success: 88, failed: 10, timeout: 2 })
    // 반올림으로 실패+시간 초과가 요청 수를 넘으면 시간 초과를 줄여 합이 요청 수를 넘지 않는다(성공은 0 밑으로 내려가지 않는다).
    expect(agentCards([row('a', { requests: 3, failureRate: 0.5, timeoutRate: 0.5 })])[0].outcome).toEqual({ success: 0, failed: 2, timeout: 1 })
    // 실패율 하나라도 비면 나눌 수 없어 막대를 그리지 않는다.
    expect(agentCards([row('a', { timeoutRate: null })])[0].outcome).toBeNull()
  })

  it('지연 막대는 카드들 중 가장 느린 p95를 100%로 본 p50·p95 위치이고, 어느 하나라도 비면 그리지 않는다', () => {
    const cards = agentCards([row('slow', { requests: 50, p50LatencyMs: 2000, p95LatencyMs: 8000 }), row('fast', { requests: 40, p50LatencyMs: 500, p95LatencyMs: 2000 }), row('empty', { requests: 10, p95LatencyMs: null })])
    expect(cards.map((c) => c.latency)).toEqual([{ p50: 0.25, p95: 1 }, { p50: 0.0625, p95: 0.25 }, null])
    // 모든 지연이 0이면 0으로 나누지 않고 막대는 비어 있다.
    expect(agentCards([row('a', { p50LatencyMs: 0, p95LatencyMs: 0 })])[0].latency).toEqual({ p50: 0, p95: 0 })
  })

  it('작은 막대의 요약 문장은 같은 값을 말로 옮기고, 값이 없으면 데이터 없음이다', () => {
    const [card] = agentCards([row('a', { p50LatencyMs: 1500, p95LatencyMs: 4200 })])
    expect(outcomeSummary(card)).toBe('처리 결과: 성공 88건, 실패 10건, 시간 초과 2건')
    expect(latencyBarSummary(card)).toBe('지연: p50 1,500ms, p95 4,200ms')
    const [empty] = agentCards([row('a', { failureRate: null, p95LatencyMs: null })])
    expect([outcomeSummary(empty), latencyBarSummary(empty)]).toEqual(['처리 결과: 데이터 없음', '지연: 데이터 없음'])
  })
})
