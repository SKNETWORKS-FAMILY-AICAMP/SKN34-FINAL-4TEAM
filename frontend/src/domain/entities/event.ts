import type { OperationsEvent } from './operations'

/** 운영 이벤트(69)의 진행 상태. 상태 컬럼이 없어 기간과 현재 시각으로만 계산합니다. */
export type EventStatus = 'always' | 'upcoming' | 'ongoing' | 'ended'
export type EventPeriod = Pick<OperationsEvent, 'startsAt' | 'endsAt'>
export const LINK_PATH_MAX = 200
/**
 * 이벤트 이동 경로(DEC-57)는 사이트 안 경로만 받습니다: `/`로 시작, `//`·`://`·공백 불가, 200자 이하. 서버 규칙과 같고, 브라우저가 `/`로 읽어 `//`처럼 외부로 갈 수 있는
 * 백슬래시도 함께 막습니다(관리자 입력 검사와 회원 화면 렌더가 같은 함수를 씁니다).
 */
export const isSitePath = (value: string | null | undefined): value is string =>
  !!value && value.length <= LINK_PATH_MAX && /^\/(?!\/)[^\s\\]*$/.test(value) && !value.includes('://')
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
