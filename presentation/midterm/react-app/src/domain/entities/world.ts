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
  facts?: { text: string; source: string; ep: number }[]
  history?: WorldVersion[]
  source?: { id: string; owner: string }
  sources?: { id: string; owner: string }[]
}

export type WorldVersion = Omit<World, 'id' | 'history' | 'owner' | 'source' | 'sources'>

/** 목업 worldVersion(): 현재 상태를 이력에 남깁니다. */
export function worldVersion(world: World) {
  ;(world.history ??= []).push(structuredClone({
    name: world.name, description: world.description, rules: world.rules, rulePublic: world.rulePublic ?? {}, facts: world.facts ?? [],
    public: world.public, allowUse: !!world.allowUse, allowFork: !!world.allowFork, allowAI: !!world.allowAI, allowPaid: !!world.allowPaid,
  }))
}

/** 목업 publicWorldRules(): 공개 범위를 정했으면 그 규칙만, 아니면 다른 작가의 세계관만 전부 공개 */
export const publicWorldRules = (world: World) => world.rules.filter((rule) => world.rulePublic ? world.rulePublic[rule] === true : !!world.owner)
