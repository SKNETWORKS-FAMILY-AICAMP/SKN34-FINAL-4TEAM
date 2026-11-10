export type WorldBasisVersion = {
  worldId: string
  revisionId: string
  revisionNo: number
  name: string
  createdAt: string
}

export type EpisodeWorldBasis = {
  revision: number
  basis: WorldBasisVersion | null
}

export type EpisodeWorldBasisChoice = Pick<WorldBasisVersion, 'worldId' | 'revisionId'> & Pick<EpisodeWorldBasis, 'revision'>
export type WorldBasisCard = { id: string; title: string; body: string }
