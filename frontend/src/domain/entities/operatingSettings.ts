export type WritingMode = 'direct' | 'assisted'

export const writingModeLabels: Record<WritingMode, string> = {
  direct: '직접 집필',
  assisted: 'AI 협업 집필',
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
