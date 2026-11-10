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
