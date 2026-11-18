import { describe, expect, it, vi } from 'vitest'

import { DELETED_CARD_NAME, isDeletedCard, putRelation } from '../entities/studioRelations'
import { invalidRelationFrom, newSetting, RELATION_EPISODE_ERROR, RELATION_FROM_ERROR, relationEpisodeInput, type StudioWorld } from '../entities/studioWorld'
import type { WorldStudioRepository } from '../repositories/WorldStudioRepository'
import { WorldStudioUseCase } from '../usecases/WorldStudioUseCase'

describe('관계 기준 회차 입력', () => {
  it('비어 있으면 최신 회차이고, 1 이상의 정수 글자면 그 회차다', () => {
    for (const text of ['', ' ', '  \t']) expect(relationEpisodeInput(text), JSON.stringify(text)).toEqual({ episode: null })
    expect(relationEpisodeInput('3')).toEqual({ episode: 3 })
    expect(relationEpisodeInput(' 12 ')).toEqual({ episode: 12 })
    expect(relationEpisodeInput('007')).toEqual({ episode: 7 })
  })

  it('0·음수·소수·숫자가 아닌 글자는 이유를 알려 거른다', () => {
    for (const text of ['0', '00', '-1', '1.5', 'abc', '1e3', '3화', '١']) expect(relationEpisodeInput(text), text).toEqual({ error: RELATION_EPISODE_ERROR })
    expect(RELATION_EPISODE_ERROR).toBe('관계 기준 회차는 1 이상의 정수로 입력해 주세요.')
  })
})

describe('WorldStudioUseCase 관계 기준 회차', () => {
  const world: StudioWorld = { id: 'w', name: '세계', description: '', version: 0, settings: [], analysis: null }
  const fake = (extra: object = {}) => ({ listStudio: vi.fn(), read: vi.fn(async () => world), create: vi.fn(), saveStudio: vi.fn(async (saved: StudioWorld) => saved), setPublication: vi.fn(), ...extra })
  const serverRepository = () => fake({ relationEpisodes: true })
  const useCase = (repository: object) => new WorldStudioUseCase(repository as WorldStudioRepository)

  it('회차별 관계를 읽고 쓰는 저장소만 지원한다고 알린다', () => {
    expect(useCase(serverRepository()).supportsRelationEpisodes).toBe(true)
    expect(useCase(fake()).supportsRelationEpisodes).toBe(false)
  })

  it('회차를 고르지 않으면 회차 없이(최신 회차) 읽고 저장한다', async () => {
    const repository = serverRepository(), cases = useCase(repository), signal = new AbortController().signal
    await cases.read('w', signal)
    await cases.save(world, signal)
    expect(repository.read).toHaveBeenCalledWith('w', signal, undefined)
    expect(repository.saveStudio).toHaveBeenCalledWith(world, signal, undefined)
  })

  it('고른 회차는 같은 취소 신호와 함께 조회·저장에 그대로 넘긴다', async () => {
    const repository = serverRepository(), cases = useCase(repository), signal = new AbortController().signal
    await cases.read('w', signal, 3)
    await cases.save(world, signal, 3)
    expect(repository.read).toHaveBeenCalledWith('w', signal, 3)
    expect(repository.saveStudio).toHaveBeenCalledWith(world, signal, 3)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('1 이상의 정수가 아닌 회차(%s)는 저장소에 닿기 전에 거절한다', async (episode) => {
    const repository = serverRepository(), cases = useCase(repository)
    await expect(cases.read('w', undefined, episode)).rejects.toThrow(RELATION_EPISODE_ERROR)
    await expect(cases.save(world, undefined, episode)).rejects.toThrow(RELATION_EPISODE_ERROR)
    expect(repository.read).not.toHaveBeenCalled()
    expect(repository.saveStudio).not.toHaveBeenCalled()
  })

  it('회차별 관계를 지원하지 않는 데모는 회차를 받지 않고 아무것도 보내지 않는다', async () => {
    const repository = fake(), cases = useCase(repository)
    await expect(cases.read('w', undefined, 2)).rejects.toThrow('데모에서는 회차별 관계를 지원하지 않습니다.')
    await expect(cases.save(world, undefined, 2)).rejects.toThrow('데모에서는 회차별 관계를 지원하지 않습니다.')
    expect(repository.read).not.toHaveBeenCalled()
    expect(repository.saveStudio).not.toHaveBeenCalled()
    await cases.read('w') // 회차를 고르지 않은 최신 조회는 데모도 그대로 쓴다
    expect(repository.read).toHaveBeenCalledTimes(1)
  })
})

describe('삭제된 설정을 끝점으로 하는 지난 회차 관계', () => {
  const person = (title: string) => ({ ...newSetting('people'), item: { ...newSetting('people').item, title } })
  const a = person('가람'), b = person('나래')
  const rows = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })

  it('끝점이 초안의 설정 카드가 아니면 삭제된 설정으로 본다', () => {
    expect(isDeletedCard(rows, a.item.id)).toBe(false)
    expect(isDeletedCard(rows, 'deleted-card')).toBe(true)
  })

  it('끝점이 비어 있는(null) 관계는 삭제된 설정이 아니라 아직 고르지 않은 것이다', () => {
    expect(isDeletedCard(rows, null)).toBe(false)
  })

  it('화면에 보일 이름은 삭제된 설정이다', () => {
    expect(DELETED_CARD_NAME).toBe('삭제된 설정')
  })
})

describe('관계마다의 N화부터(fromEpisode, DEC-54 2단계)', () => {
  const person = (title: string) => ({ ...newSetting('people'), item: { ...newSetting('people').item, title } })
  const [a, b] = [person('가람'), person('나래')]
  const rows = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'friend_of', polarity: 'asserted' })
  const withFrom = (fromEpisode: number | undefined): StudioWorld => ({
    id: 'w', name: '세계', description: '', version: 1, linkedWorkId: 'work-1', analysis: null,
    settings: rows.map((row) => (row.item.kind === 'relation' ? { ...row, item: { ...row.item, fromEpisode } } : row)),
  })

  it('값이 있는데 1 이상의 정수가 아니면 잘못이고, 값이 없는 것은 여기서 거르지 않는다', () => {
    for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(invalidRelationFrom({ fromEpisode: n }), String(n)).toBe(true)
    for (const n of [undefined, 1, 7]) expect(invalidRelationFrom({ fromEpisode: n }), String(n)).toBe(false)
    expect(RELATION_FROM_ERROR).toBe('관계가 몇 화부터인지 1 이상의 정수로 입력해 주세요.')
  })

  it('저장은 잘못된 N화부터를 저장소에 닿기 전에 같은 문구로 거절하고, 값이 없거나 올바르면 그대로 넘긴다', async () => {
    const repository = { listStudio: vi.fn(), read: vi.fn(), create: vi.fn(), saveStudio: vi.fn(async (saved: StudioWorld) => saved), setPublication: vi.fn(), relationEpisodes: true as const }
    const cases = new WorldStudioUseCase(repository as unknown as WorldStudioRepository)
    for (const n of [0, -2, 2.5, Number.NaN]) await expect(cases.save(withFrom(n)), String(n)).rejects.toThrow(RELATION_FROM_ERROR)
    expect(repository.saveStudio).not.toHaveBeenCalled()
    await cases.save(withFrom(undefined))
    await cases.save(withFrom(3))
    expect(repository.saveStudio).toHaveBeenCalledTimes(2)
  })
})
