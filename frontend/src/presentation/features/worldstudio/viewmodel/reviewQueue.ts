import { currentCandidate, type Analysis, type Candidate } from '../../../../domain/entities/initialWorld'

export type ReviewFilter = 'pending' | 'approved' | 'rejected'
export type ReviewItem = { original: Candidate; current: ReturnType<typeof currentCandidate> }

/**
 * AI 후보를 가장 큰 결정 순번의 상태로 세 묶음으로 나눈다(분석이 준 순서를 지킨다). 결정이 없거나 보류한 후보는 아직 끝나지 않은 검토라 '검토 대기'에 든다.
 * 후보 검토 시트의 필터 칩과 '검토 대기 N' 버튼이 같은 숫자를 쓰도록 한 곳에서 센다.
 */
export function reviewGroups(analysis: Analysis | undefined): Record<ReviewFilter, ReviewItem[]> {
  const groups: Record<ReviewFilter, ReviewItem[]> = { pending: [], approved: [], rejected: [] }
  if (!analysis?.output) return groups
  for (const original of analysis.output.candidates) {
    const current = currentCandidate(analysis, original)
    groups[current.state === 'approved' ? 'approved' : current.state === 'rejected' ? 'rejected' : 'pending'].push({ original, current })
  }
  return groups
}

/** 관리 화면의 `AI 검토` 버튼 이름: 설정집 검토 의견과 후보 검토 대기가 있을 때만 그 수를 짧게 붙인다(`AI 검토 · 의견 5 · 후보 2`). */
export const reviewButtonLabel = (opinions: number, waiting: number) =>
  ['AI 검토', opinions > 0 && `의견 ${opinions}`, waiting > 0 && `후보 ${waiting}`].filter(Boolean).join(' · ')
