/** 집필 방식: 직접 집필·AI 협업 집필·AI 자율 집필(autonomous). AI 자율 집필을 저장하면 서버가 AI 집필(자율 연재)을 켜고, 다른 방식으로 바꾸면 끈다. */
export type WritingMode = 'direct' | 'assisted' | 'autonomous'

export const writingModeLabels: Record<WritingMode, string> = {
  direct: '직접 집필',
  assisted: 'AI 협업 집필',
  autonomous: 'AI 자율 집필',
}

type WorkSettingsChange = {
  revision: number
  writingMode: WritingMode
  changedAt: string
}

export type WorkSettings = {
  current: WorkSettingsChange | { revision: 0; writingMode: null; changedAt: null }
  history: WorkSettingsChange[]
  worldUpdateMode: 'manual'
  proofreadingMode: 'review'
  autoserialState: 'off'
}
