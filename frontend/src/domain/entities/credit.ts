/** 목업 S.admin.alerts: AI 데모 작업 실패 기록 */
export type AiAlert = { id: string; task: string; status: string; stage: string; error: string; action: string; detail: string; resolved: boolean }

/** 목업 S.demoCredits·demoUsage·demoFailNext: 실제 요금과 무관한 데모 잔액 */
export type DemoCredits = { credits: number; usage: { task: string; cost: number }[]; failNext: boolean; alerts: AiAlert[] }
