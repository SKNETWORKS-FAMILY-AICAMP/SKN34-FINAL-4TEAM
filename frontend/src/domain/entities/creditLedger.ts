/** Core 크레딧 원장(GET /api/v1/me/credits·history) 응답을 화면이 쓰는 값으로 옮긴 타입. 스튜디오 데모 AI 차감 상태(`credit.ts`)와는 별개입니다. */
export type CreditBalanceItem = { kind: string; remaining: number; expiresAt: string }
/** 사용 가능한 크레딧 합계와 지급분별 남은 양(소멸이 빠른 순). */
export type CreditBalance = { total: number; items: CreditBalanceItem[] }
export type CreditHistoryType = 'grant' | 'spend' | 'expire'
/** 지급·사용·소멸 한 건. kind는 지급 종류 코드(가입 체험 등)입니다. */
export type CreditHistoryItem = { type: CreditHistoryType; kind: string; amount: number; occurredAt: string }
export type CreditOverview = { balance: CreditBalance; history: CreditHistoryItem[] }

const KIND_LABEL: Record<string, string> = { 'signup-trial': '가입 체험 크레딧', reward: '보상 크레딧', event: '이벤트 크레딧' }
/** 서버 지급 종류 코드를 화면 이름으로 바꿉니다. 모르는 코드는 숨기지 않고 그대로 보입니다. */
export const creditKindLabel = (kind: string) => KIND_LABEL[kind] ?? kind
export const creditHistoryLabel: Record<CreditHistoryType, string> = { grant: '지급', spend: '사용', expire: '소멸' }
