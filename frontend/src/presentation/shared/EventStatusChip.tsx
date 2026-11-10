import { EVENT_STATUS_LABELS, type EventStatus } from '../../domain/entities/event'

/** 이벤트 진행 상태 칩(표시 전용). 상태 계산은 ViewModel이 합니다. */
export function EventStatusChip({ status }: { status: EventStatus }) {
  return <span className={`chip${status === 'upcoming' ? ' wait' : status === 'ended' ? '' : ' ok'}`}>{EVENT_STATUS_LABELS[status]}</span>
}
