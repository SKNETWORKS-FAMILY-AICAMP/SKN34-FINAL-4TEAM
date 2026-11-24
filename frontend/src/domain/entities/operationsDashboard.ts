import { llmPageHref } from './admin'
import { count, percent, usd } from './llmOps'
import type { Funnel } from './operationsFunnel'

/** 운영 대시보드(DEC-55). 출처 하나가 실패하면 그 칸만 null이고 `unavailable`에 출처가 들어옵니다. 실패를 0으로 바꾸지 않습니다. */
type AiSummary = { requests: number; failed: number; timeouts: number; failureRate?: number | null; costUser: number; costPlatform: number }
export type Dashboard = {
  members?: { total?: number | null; joinedLast7Days?: number | null; withdrawalPending?: number | null } | null
  ai?: { today: AiSummary; last7Days: AiSummary } | null
  jobs?: { running?: number | null; failedLast24h?: number | null } | null
  pending?: { inquiries?: number | null; reports?: number | null; authorReviews?: number | null } | null
  openAlerts?: number | null
  /** 서비스 지표(DEC-57). Content를 읽지 못하면 null이고 `unavailable`에 content가 들어옵니다. */
  funnel?: Funnel | null
  unavailable: string[]
}
/** value가 null이면 출처를 불러오지 못한 칸입니다. */
type DashboardCard = { key: string; label: string; value: string | null; details: string[]; to?: string }

const unit = (value: number | null | undefined, suffix: string) => value == null ? null : `${count(value)}${suffix}`

export function dashboardCards(d: Dashboard): DashboardCard[] {
  const { members, jobs, pending } = d
  const ai = (key: string, label: string, s?: AiSummary): DashboardCard => ({
    key, label, value: s ? unit(s.requests, '건') : null,
    details: s ? [`실패 ${count(s.failed)}건 · 실패율 ${percent(s.failureRate)}`, `시간 초과 ${count(s.timeouts)}건`, `비용 사용자 ${usd(s.costUser)} · 플랫폼 ${usd(s.costPlatform)}`] : [],
  })
  return [
    {
      key: 'members', label: '전체 회원', value: unit(members?.total, '명'),
      details: members ? [`최근 7일 가입 ${unit(members.joinedLast7Days, '명') ?? '—'}`, `탈퇴 유예 ${unit(members.withdrawalPending, '명') ?? '—'}`] : [],
    },
    ai('aiToday', 'AI 요청 · 오늘', d.ai?.today),
    ai('aiWeek', 'AI 요청 · 최근 7일', d.ai?.last7Days),
    { key: 'jobs', label: '진행 중 작업', value: unit(jobs?.running, '건'), details: jobs ? [`최근 24시간 실패 ${unit(jobs.failedLast24h, '건') ?? '—'}`] : [], to: '/admin?tab=jobs' },
    { key: 'inquiries', label: '답변 대기 문의', value: unit(pending?.inquiries, '건'), details: [], to: '/admin?tab=feedback' },
    { key: 'reports', label: '접수 신고', value: unit(pending?.reports, '건'), details: [], to: '/admin?tab=rights' },
    { key: 'authorReviews', label: '작가 검토 대기', value: unit(pending?.authorReviews, '건'), details: [] },
    { key: 'openAlerts', label: '미확인 경고', value: unit(d.openAlerts, '건'), details: [], to: llmPageHref('alerts') },
  ]
}

/**
 * AI 요청·작업·경고 성격의 카드(#857, 넷): 대시보드가 아니라 LLM Ops 에이전트 지표 위에 보입니다. 진행 중 작업은 전처리·회귀 평가 같은 AI 작업이라 이쪽입니다.
 * 나머지 넷(회원·답변 대기 문의·접수 신고·작가 검토 대기)이 대시보드의 서비스 지표 카드입니다. 두 띠 모두 넷이라 2열(넓은 화면 4열)에서 마지막 줄이 비지 않습니다.
 */
const AI_CARDS = ['aiToday', 'aiWeek', 'jobs', 'openAlerts']
export const serviceCards = (d: Dashboard) => dashboardCards(d).filter((card) => !AI_CARDS.includes(card.key))
export const aiCards = (d: Dashboard) => dashboardCards(d).filter((card) => AI_CARDS.includes(card.key))
