/** 운영 공지·이벤트 CRUD의 독립 메모리 데모. 필드는 운영 DTO와 맞추지만 HTTP·인증·버전 충돌은 연결하지 않습니다. */
export type NoticeInput = { title: string; body: string }
export type EventInput = NoticeInput & { startsAt: string | null; endsAt: string | null }
type RecordIdentity = { id: string; createdAt: string; updatedAt: string }
export type OperationsNotice = NoticeInput & RecordIdentity
export type OperationsEvent = EventInput & RecordIdentity

/** 알려진 업무 입력·대상 오류만 화면에 그대로 안내합니다. 외부 예외 내용은 노출하지 않습니다. */
export class OperationsError extends Error {}

/** 권한이 없다는 403 응답. 화면이 일반 실패 대신 업무별 권한 안내를 보이도록 구분합니다. */
export class OperationsForbidden extends OperationsError {}

/** 서버가 대상의 상태 때문에 거절하며 보낸 안내 문구(404·409)를 그대로 담습니다. 다시 시도해도 같은 결과입니다. */
export class OperationsRejected extends OperationsError {}

/** datetime-local의 시간대는 브라우저 설정이 아니라 명시된 한국시간(UTC+09:00)입니다. */
export function toUtcFromKoreanInput(value: string): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new OperationsError('날짜와 시간을 확인해 주세요.')
  const date = new Date(value + ':00+09:00')
  if (!Number.isFinite(date.getTime()) || toKoreanDateTimeInput(date.toISOString()) !== value) throw new OperationsError('날짜와 시간을 확인해 주세요.')
  return date.toISOString()
}

export function toKoreanDateTimeInput(value: string | null): string {
  return value ? new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''
}
