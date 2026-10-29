export type World = {
  id: string
  name: string
  description: string
  rules: string[]
  public: boolean
  owner?: string
  allowUse?: boolean
  allowFork?: boolean
  allowAI?: boolean
  allowPaid?: boolean
  rulePublic?: Record<string, boolean>
  history?: Omit<World, 'history'>[]
  source?: { id: string; owner: string }
  sources?: { id: string; owner: string }[]
}
