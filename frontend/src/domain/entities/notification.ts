/** Core 알림 분류 코드. 읽기·창작만 회원이 끌 수 있습니다(UC-27). */
export type NoticeKind = 'reading' | 'creation' | 'result' | 'credit' | 'rights-security'

export type AppNotification = {
  id: string
  kind: NoticeKind
  /** 서버가 만든 한 줄 문구. 비공개 원고·개인정보는 담지 않습니다. */
  summary: string
  targetType: string | null
  targetId: string | null
  /** ISO 8601 */
  createdAt: string
  read: boolean
}

export type NotificationPage = { items: AppNotification[]; nextCursor: string | null }

const LABELS: Record<NoticeKind, string> = { reading: '읽기', creation: '작가 소식', result: '처리 결과', credit: '크레딧', 'rights-security': '권리·보안' }
export const noticeLabel = (kind: NoticeKind) => LABELS[kind]

/**
 * 알림에서 이동할 화면. 사건 계약이 확정된 대상만 연결하고, 모르는 대상은 이동하지 않습니다.
 * 이동 뒤 접근 가능 여부는 대상 화면·소유 서비스가 다시 확인합니다.
 */
export function noticeTarget(n: Pick<AppNotification, 'targetType' | 'targetId'>): string | null {
  if (n.targetType === 'work' && n.targetId) return `/work/${encodeURIComponent(n.targetId)}`
  return null
}
