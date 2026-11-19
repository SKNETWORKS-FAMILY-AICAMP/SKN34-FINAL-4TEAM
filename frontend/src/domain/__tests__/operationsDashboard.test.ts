import { describe, expect, it } from 'vitest'

import { alertRuleLabel, alertStatusLabel } from '../entities/operationsAlert'
import { dashboardCards, type Dashboard } from '../entities/operationsDashboard'

const summary = (requests: number, failed: number, timeouts: number, failureRate: number | null, costUser: number, costPlatform: number) =>
  ({ requests, failed, timeouts, failureRate, costUser, costPlatform })
const full: Dashboard = {
  members: { total: 1280, joinedLast7Days: 31, withdrawalPending: 2 },
  ai: { today: summary(12, 3, 1, 0.25, 0, 0.0123), last7Days: summary(80, 4, 0, null, 0, 0.5) },
  jobs: { running: 2, failedLast24h: 1 },
  pending: { inquiries: 4, reports: 0, authorReviews: 7 },
  openAlerts: 3,
  unavailable: [],
}
const card = (d: Dashboard, key: string) => dashboardCards(d).find((c) => c.key === key)!

describe('운영 대시보드 카드 (DEC-55)', () => {
  it('값이 있는 칸은 숫자와 단위로 보이고 0도 0으로 보이며, 이동할 탭이 있는 칸은 링크를 가진다', () => {
    expect(card(full, 'members')).toEqual({ key: 'members', label: '전체 회원', value: '1,280명', details: ['최근 7일 가입 31명', '탈퇴 유예 2명'] })
    expect(card(full, 'aiToday')).toEqual({
      key: 'aiToday', label: 'AI 요청 · 오늘', value: '12건',
      details: ['실패 3건 · 실패율 25%', '시간 초과 1건', '비용 사용자 $0.0000 · 플랫폼 $0.0123'],
    })
    // 요청이 없어 실패율을 못 구한 칸은 0%가 아니라 '데이터 없음'이다.
    expect(card(full, 'aiWeek').details[0]).toBe('실패 4건 · 실패율 데이터 없음')
    expect(card(full, 'reports')).toEqual({ key: 'reports', label: '접수 신고', value: '0건', details: [], to: '/admin?tab=rights' })
    expect(card(full, 'inquiries').to).toBe('/admin?tab=feedback')
    expect(card(full, 'jobs')).toMatchObject({ value: '2건', details: ['최근 24시간 실패 1건'], to: '/admin?tab=jobs' })
    expect(dashboardCards(full).map((c) => c.key)).toEqual(['members', 'aiToday', 'aiWeek', 'jobs', 'inquiries', 'reports', 'authorReviews', 'openAlerts'])
  })

  it('출처가 실패해 비어 온 칸은 값이 null이고 0으로 채우지 않는다', () => {
    const cards = dashboardCards({
      ...full, members: null, ai: undefined, pending: { inquiries: 4, reports: null, authorReviews: undefined }, openAlerts: null, unavailable: ['core', 'langfuse', 'content'],
    })
    expect(cards.filter((c) => c.value === null).map((c) => c.key)).toEqual(['members', 'aiToday', 'aiWeek', 'reports', 'authorReviews', 'openAlerts'])
    expect(cards.find((c) => c.key === 'members')!.details).toEqual([])
    expect(cards.find((c) => c.key === 'inquiries')!.value).toBe('4건')
  })
})

describe('경고 라벨', () => {
  it('시드 규칙 키와 상태는 한국어로, 모르는 값은 그대로 보인다', () => {
    expect(alertRuleLabel('ai_failure_rate')).toBe('AI 실패율')
    expect(alertRuleLabel('future_rule')).toBe('future_rule')
    expect(alertStatusLabel('open')).toBe('미확인')
    expect(alertStatusLabel('resolved')).toBe('조치 완료')
    expect(alertStatusLabel('toString')).toBe('toString')
  })
})
