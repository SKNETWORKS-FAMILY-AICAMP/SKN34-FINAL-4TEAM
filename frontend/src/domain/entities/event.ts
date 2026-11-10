import type { OperationsEvent } from './operations'

/** 운영 이벤트(69)의 진행 상태. 상태 컬럼이 없어 기간과 현재 시각으로만 계산합니다. */
export type EventStatus = 'always' | 'upcoming' | 'ongoing' | 'ended'
export type EventPeriod = Pick<OperationsEvent, 'startsAt' | 'endsAt'>
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = { always: '상시', upcoming: '예정', ongoing: '진행 중', ended: '종료' }

/**
 * 계약의 상태 규칙: 기간이 모두 없으면 상시, 현재 < 시작이면 예정, 현재 ≥ 종료이면 종료, 그 밖은 진행 중입니다.
 * 현재 시각은 호출자가 넘기며 서버 시계가 아니라 브라우저 시계 기준입니다.
 */
export function eventStatus({ startsAt, endsAt }: EventPeriod, now: Date): EventStatus {
  if (startsAt === null && endsAt === null) return 'always'
  if (startsAt !== null && now.getTime() < Date.parse(startsAt)) return 'upcoming'
  if (endsAt !== null && now.getTime() >= Date.parse(endsAt)) return 'ended'
  return 'ongoing'
}
