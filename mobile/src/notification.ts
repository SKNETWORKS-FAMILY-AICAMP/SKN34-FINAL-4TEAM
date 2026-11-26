import { z } from 'zod'

/** Core 알림 분류 코드(웹 frontend/src/domain/entities/notification.ts와 같다). 읽기·창작·AI·외부 도구 변경만 회원이 끌 수 있다. */
const noticeKind = z.enum(['reading', 'creation', 'result', 'credit', 'rights-security', 'ai-tool'])
export type NoticeKind = z.infer<typeof noticeKind>

/** 알림 한 건(웹 알림 API·브리지 메시지와 같은 형식). */
export const notice = z.object({
  id: z.string().min(1), kind: noticeKind, summary: z.string(), targetType: z.string().nullable(), targetId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }), read: z.boolean(),
})
export type AppNotification = z.infer<typeof notice>

const LABELS: Record<NoticeKind, string> = { reading: '읽기', creation: '작가 소식', result: '처리 결과', credit: '크레딧', 'rights-security': '권리·보안', 'ai-tool': 'AI·외부 도구 변경' }
export const noticeLabel = (kind: NoticeKind) => LABELS[kind]

/**
 * 알림에서 이동할 웹 화면 경로. 웹 noticeTarget과 같은 규칙이라 같은 기대값으로 시험한다(notification.test.ts).
 * 사건 계약이 확정된 대상만 연결하고, 모르는 대상은 이동하지 않는다.
 */
export function noticeTarget(n: Pick<AppNotification, 'kind' | 'targetType' | 'targetId'>): string | null {
  if (n.kind === 'ai-tool' && n.targetId) {
    const id = encodeURIComponent(n.targetId)
    if (n.targetType === 'world') return `/worldstudio/${id}`
    if (n.targetType === 'work') return `/studio/${id}`
  }
  if (n.targetType === 'work' && n.targetId) return `/work/${encodeURIComponent(n.targetId)}`
  if (n.targetType === 'credit-expiry') return '/me/pay'
  if (n.targetType === 'withdrawal') return '/me/profile?focus=withdrawal'
  if (n.targetType === 'alert') return '/admin?tab=llm&view=alerts'
  return null
}

const payload = z.object({ kind: noticeKind, targetType: z.string().optional(), targetId: z.string().optional() })

/** 로컬·원격 알림에 실린 데이터(kind·targetType·targetId)에서 이동 경로를 만든다. 형식이 다르면 이동하지 않는다. */
export function payloadTarget(data: unknown): string | null {
  const parsed = payload.safeParse(data)
  return parsed.success ? noticeTarget({ kind: parsed.data.kind, targetType: parsed.data.targetType ?? null, targetId: parsed.data.targetId ?? null }) : null
}
