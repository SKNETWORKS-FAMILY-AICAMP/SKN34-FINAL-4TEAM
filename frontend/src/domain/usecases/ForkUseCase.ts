import { canView, forkList, isMine, type Role } from '../entities/work'
import type { WorkRepository } from '../repositories/WorkRepository'

export type ForkInput = { dir: string; title: string; historyConsent: boolean }

const DENIED = '현재 이 회차는 포크할 수 없어요'

/** 목업 fork()·startFork·forked(): 원작의 허용 회차 시점 스냅샷으로 포크 소설을 만듭니다. */
export class ForkUseCase {
  private readonly workRepository: WorkRepository
  constructor(workRepository: WorkRepository) { this.workRepository = workRepository }

  private async load(id: string) {
    const [works, worlds] = await Promise.all([this.workRepository.listWorks(), this.workRepository.listWorlds()])
    const work = works.find((w) => w.id === id || w.slug === id)
    return { works, work, list: forkList(work, worlds) }
  }

  /** 포크 폼(U09). 원작이 없으면 null, 이미 포크했으면 existing */
  async getForm(id: string, episode?: number) {
    const { works, work, list } = await this.load(id)
    if (!work) return null
    const at=episode && list.includes(episode)?episode:list[0]
    return {
      work: work.canonical && at ? await this.workRepository.readWorld(work,at) : work,
      forkList: list,
      basisEpisode: at ?? 0,
      existing: works.find((w) => w.parent === work.id && isMine(w)) ?? null,
      historyConsentNeeded: !work.canonical && !work.worldIds && !work.ruleFrom,
    }
  }

  async startFork(id: string, at: number, input: ForkInput): Promise<{ error: string } | { id: string }> {
    const { works, work, list } = await this.load(id)
    if (!work || !list.includes(at) || works.some((w) => w.parent === work.id && isMine(w))) return { error: DENIED }
    if (!work.canonical && !work.worldIds && !work.ruleFrom && !input.historyConsent) return { error: '설정 이력 안내를 확인해 주세요' }
    const dir = input.dir.trim(), title = input.title.trim()
    if (!work.canonical && !dir) return { error: '무엇이 달라지는지 한 줄 적어 주세요' }
    if (!title || title.endsWith(':')) return { error: '제목을 적어 주세요' }
    return this.workRepository.createFork(work.id, at, title, dir)
  }

  /** 포크 생성 완료(U10) */
  async getForked(id: string, role: Role) {
    const works = await this.workRepository.listWorks()
    const fork = works.find((w) => w.id === id)
    const parent = works.find((w) => w.id === fork?.parent)
    return canView(fork, role) && fork.snap && (parent || fork.canonical) ? { fork, parent } : null
  }
}
