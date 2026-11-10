export type PublicationSchedule = {
  id: string
  versionId: string
  scheduledAt: string
  status: 'pending' | 'published' | 'failed' | 'canceled'
  revision: number
  completedAt: string | null
  failureReason: string | null
}

export type PublicationScheduleInput = Pick<PublicationSchedule, 'versionId' | 'scheduledAt'> & { rightsConfirmed: boolean }
export type PublicationScheduleRevision = Pick<PublicationSchedule, 'id' | 'revision'>

export function toKstDateTimeInput(instant: string) {
  const koreaOffsetMs = 9 * 60 * 60 * 1000
  return new Date(Date.parse(instant) + koreaOffsetMs).toISOString().slice(0, 16)
}

const SCHEDULER_GRACE_MS = 6_000 // 서버 스케줄러 5초 주기 다음
const MAX_TIMER_MS = 2 ** 31 - 1 // 이보다 길면 setTimeout이 즉시 실행된다

/** 예약 시각 직후의 실행 결과를 한 번 다시 읽을 때까지 남은 ms. 이미 지났거나 setTimeout 한계를 넘으면 null. */
export function resultReloadDelay(scheduledAt: string, now = Date.now()) {
  const delay = Date.parse(scheduledAt) + SCHEDULER_GRACE_MS - now
  return delay > 0 && delay <= MAX_TIMER_MS ? delay : null
}
