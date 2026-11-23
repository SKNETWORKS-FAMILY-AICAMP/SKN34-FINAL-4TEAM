import { describe, expect, it } from 'vitest'

import {
  baseEpisodeBars, baseEpisodeSummary, funnelGroups, groupSummary, proportionText, reactionsPerEpisode, reactionSummary, reactionText, type Funnel,
} from '../entities/operationsFunnel'

const funnel: Funnel = {
  readers: { viewed: 400, readAny: 160, readNext: 40 },
  reactions: { publishedEpisodes: 40, likes: 130, interests: 60, comments: 10 },
  forks: {
    readers: 160, readerForked: 16,
    baseEpisodes: [{ bucket: '1', count: 5 }, { bucket: '2', count: 3 }, { bucket: '3', count: 0 }, { bucket: '4-5', count: 2 }, { bucket: '6-10', count: 1 }, { bucket: '11+', count: 4 }],
  },
  writers: { forks: 25, saved: 20, published: 5, medianHoursToPublish: 12.5 },
  proposals: { adopted: 30, total: 120 },
  feedback: { approved: 8, decided: 16 },
}

describe('퍼널 비율과 오차 (DEC-57)', () => {
  it('비율은 분자 ÷ 분모이고 오차는 95% 최악 기준 ±1/√n이며 n과 함께 적는다', () => {
    expect(proportionText(170, 400)).toBe('42.5% ±5.0%p · n=400')
    expect(proportionText(0, 400)).toBe('0.0% ±5.0%p · n=400')
    expect(proportionText(1, 1)).toBe('100.0% ±100.0%p · n=1')
    expect(proportionText(25, 120)).toBe('20.8% ±9.1%p · n=120')
    expect(proportionText(1_280, 4_000)).toBe('32.0% ±1.6%p · n=4,000')
  })

  it('분모가 0이면 0%로 채우지 않고 —로 보인다', () => {
    expect(proportionText(0, 0)).toBe('— · n=0')
  })

  it('분자가 분모보다 커도(정의가 어긋난 데이터) 깎지 않고 그대로 보인다', () => {
    expect(proportionText(5, 4)).toBe('125.0% ±50.0%p · n=4')
  })
})

describe('단계 막대 4묶음', () => {
  const groups = funnelGroups(funnel)

  it('독자 조회→1화 이상→이어 읽기, 독자→Fork, Fork→저장→발행, AI 채택·수정 제안 승인 순서이고 단계 값은 서버 수 그대로다', () => {
    expect(groups.map((g) => g.key)).toEqual(['readers', 'forks', 'writers', 'ai'])
    expect(groups.map((g) => g.steps.map((s) => s.count))).toEqual([[400, 160, 40], [160, 16], [25, 20, 5], [120, 30, 16, 8]])
    expect(groups.map((g) => g.unit)).toEqual(['명', '명', '개', '건'])
  })

  it('단계 사이 비율은 직전 단계를 분모로 하고 AI 채택·수정 제안 승인은 각자의 분모(생성·결정)를 쓴다', () => {
    const texts = groups.map((g) => g.rates.map((r) => `${r.label}: ${r.text}`))
    expect(texts).toEqual([
      ['조회 → 1화 이상 읽음: 40.0% ±5.0%p · n=400', '1화 이상 → 이어 읽기: 25.0% ±7.9%p · n=160'],
      ['독자 → Fork 생성: 10.0% ±7.9%p · n=160'],
      ['Fork → 직접 저장: 80.0% ±20.0%p · n=25', '저장 → 직접 발행: 25.0% ±22.4%p · n=20'],
      ['AI 제안 채택률: 25.0% ±9.1%p · n=120', '수정 제안 승인률: 50.0% ±25.0%p · n=16'],
    ])
  })

  it('Fork 작가 묶음은 첫 발행까지 걸린 시간의 중앙값(소수 1자리)을 덧붙이고 발행이 없으면 —로 보인다', () => {
    expect(groups[2].note).toBe('첫 발행까지 걸린 시간의 중앙값 12.5시간')
    expect(funnelGroups({ ...funnel, writers: { ...funnel.writers, medianHoursToPublish: 12 } })[2].note).toBe('첫 발행까지 걸린 시간의 중앙값 12.0시간')
    expect(funnelGroups({ ...funnel, writers: { ...funnel.writers, published: 0, medianHoursToPublish: null } })[2].note).toBe('첫 발행까지 걸린 시간의 중앙값 — (직접 발행한 Fork가 아직 없어요)')
    expect(groups[0].note).toBeUndefined()
  })

  it('차트의 값을 말로 옮긴 요약은 단계 이름과 수를 모두 담는다', () => {
    expect(groupSummary(groups[0])).toBe('독자 이어 읽기: 조회 기록이 있는 독자 400명, 1화 이상 읽음 160명, 이어 읽기 40명')
  })
})

describe('회차당 반응', () => {
  it('좋아요·관심·댓글을 발행 회차 수로 나누고 소수 둘째 자리까지 보이며 n은 발행 회차 수다', () => {
    const rows = reactionsPerEpisode(funnel.reactions)
    expect(rows.map((r) => [r.label, r.perEpisode, r.n])).toEqual([['좋아요', 3.25, 40], ['관심', 1.5, 40], ['댓글', 0.25, 40]])
    expect(rows.map(reactionText)).toEqual(['3.25 · 발행 회차 n=40', '1.50 · 발행 회차 n=40', '0.25 · 발행 회차 n=40'])
  })

  it('발행 회차가 0이면 —로 보인다', () => {
    const rows = reactionsPerEpisode({ publishedEpisodes: 0, likes: 3, interests: 0, comments: 0 })
    expect(rows.map((r) => r.perEpisode)).toEqual([null, null, null])
    expect(reactionText(rows[0])).toBe('— · 발행 회차 n=0')
    expect(reactionSummary(rows)).toBe('회차당 반응(발행 회차 0개): 좋아요 —, 관심 —, 댓글 —')
  })

  it('차트의 값을 말로 옮긴 요약은 세 반응의 회차당 값을 담는다', () => {
    expect(reactionSummary(reactionsPerEpisode(funnel.reactions))).toBe('회차당 반응(발행 회차 40개): 좋아요 3.25, 관심 1.50, 댓글 0.25')
  })
})

describe('Fork 기준 회차 분포', () => {
  it('서버가 준 구간 순서 그대로 구간 이름을 읽기 좋게 바꾸고 0인 구간도 그대로 둔다', () => {
    expect(baseEpisodeBars(funnel.forks)).toEqual([
      { label: '1화', count: 5 }, { label: '2화', count: 3 }, { label: '3화', count: 0 },
      { label: '4~5화', count: 2 }, { label: '6~10화', count: 1 }, { label: '11화 이상', count: 4 },
    ])
    // 모르는 구간 이름은 그대로 보인다.
    expect(baseEpisodeBars({ ...funnel.forks, baseEpisodes: [{ bucket: '기타', count: 1 }] })).toEqual([{ label: '기타', count: 1 }])
  })

  it('차트의 값을 말로 옮긴 요약은 구간별 Fork 수를 담는다', () => {
    expect(baseEpisodeSummary(baseEpisodeBars(funnel.forks))).toBe('Fork 기준 회차 분포: 1화 5개, 2화 3개, 3화 0개, 4~5화 2개, 6~10화 1개, 11화 이상 4개')
  })
})
