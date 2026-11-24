import { llmPageHref } from './admin'

/** Core 알림 분류 코드. 읽기·창작·AI·외부 도구 변경만 회원이 끌 수 있습니다(UC-27, #553). */
export type NoticeKind = 'reading' | 'creation' | 'result' | 'credit' | 'rights-security' | 'ai-tool'

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

const LABELS: Record<NoticeKind, string> = { reading: '읽기', creation: '작가 소식', result: '처리 결과', credit: '크레딧', 'rights-security': '권리·보안', 'ai-tool': 'AI·외부 도구 변경' }
export const noticeLabel = (kind: NoticeKind) => LABELS[kind]

/**
 * 알림에서 이동할 화면. 사건 계약이 확정된 대상만 연결하고, 모르는 대상은 이동하지 않습니다.
 * 이동 뒤 접근 가능 여부는 대상 화면·소유 서비스가 다시 확인합니다.
 */
export function noticeTarget(n: Pick<AppNotification, 'kind' | 'targetType' | 'targetId'>): string | null {
  // 같은 work 대상이어도 AI·외부 도구 변경은 작가가 보던 집필실·세계관 관리로 보냅니다(운영자 조치 같은 다른 분류는 작품 상세).
  if (n.kind === 'ai-tool' && n.targetId) {
    const id = encodeURIComponent(n.targetId)
    if (n.targetType === 'world') return `/worldstudio/${id}`
    if (n.targetType === 'work') return `/studio/${id}`
  }
  if (n.targetType === 'work' && n.targetId) return `/work/${encodeURIComponent(n.targetId)}`
  // Core 사건(docs/notification-event-contract.md): 대상 id(소멸 날짜·탈퇴 요청 id)는 화면 주소에 쓰지 않고 본인 계정 화면으로 보냅니다.
  if (n.targetType === 'credit-expiry') return '/me/pay'
  // 탈퇴 취소 카드는 프로필 맨 아래라, 알림에서 왔다는 표시(focus)를 붙여 그 카드로 스크롤·포커스합니다(화면 안 이동에 #anchor를 쓰지 않음).
  if (n.targetType === 'withdrawal') return '/me/profile?focus=withdrawal'
  // 운영 경고(operations.alert.raised): 대상 id는 주소에 쓰지 않고 경고를 확인·처리하는 LLM Ops의 경고·누설 감시 쪽으로 보냅니다.
  if (n.targetType === 'alert') return llmPageHref('alerts')
  return null
}

/**
 * 열린 대상(작품·세계관)을 바꾼 `ai-tool` 알림이 새로 왔는지 판정합니다(#553). 서버가 준 `createdAt`끼리만 시점으로 비교하고 클라이언트 시계는 쓰지 않습니다.
 * baseline: undefined=아직 읽지 않음(이번 읽기가 기준선이 되고 변경으로 보지 않음), null=읽었지만 열린 대상의 알림이 없었음. 기준선은 뒤로 가지 않습니다.
 * ponytail: 밀리초 해상도로 비교합니다. 저장마다 별도 요청이라 한 대상을 같은 밀리초에 두 번 바꿀 수 없습니다.
 */
export function mcpChange(
  items: Pick<AppNotification, 'kind' | 'targetType' | 'targetId' | 'createdAt'>[],
  target: { targetType: string; targetId: string },
  baseline: string | null | undefined,
): { baseline: string | null; changed: boolean } {
  let latest: string | null = null
  for (const n of items) {
    if (n.kind === 'ai-tool' && n.targetType === target.targetType && n.targetId === target.targetId && (latest === null || Date.parse(n.createdAt) > Date.parse(latest))) latest = n.createdAt
  }
  if (baseline === undefined) return { baseline: latest, changed: false }
  const changed = latest !== null && (baseline === null || Date.parse(latest) > Date.parse(baseline))
  return { baseline: changed ? latest : baseline, changed }
}
