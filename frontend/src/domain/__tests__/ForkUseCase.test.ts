import { describe, expect, it } from 'vitest'

import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { cardTypes } from '../entities/studioCards'
import { withWorldCards, type ReaderWorldCard, type ReaderWorldCards } from '../entities/wiki'
import { publicCast } from '../entities/work'
import type { WorkRepository } from '../repositories/WorkRepository'
import { ForkUseCase } from '../usecases/ForkUseCase'

const setup = () => {
  const db = createFixtureDb()
  const repo = new InMemoryWorkRepository(db)
  return { db, repo, useCase: new ForkUseCase(repo) }
}
const input = { dir: '성진이 털어놓았다면?', title: '구운몽: 연화봉', historyConsent: true }

describe('ForkUseCase (목업 fork()·startFork·forked())', () => {
  it('허용 회차에서만 포크하고 비허용 작품·회차는 거부한다', async () => {
    const { useCase } = setup()
    expect(await useCase.startFork('guunmong', 1, input)).toEqual({ error: '현재 이 회차는 포크할 수 없어요' })
    expect(await useCase.startFork('hong', 1, input)).toEqual({ error: '현재 이 회차는 포크할 수 없어요' })
    expect((await useCase.getForm('hong'))?.forkList).toEqual([])
  })

  it('방향·제목을 검증하고 한 원작에서 한 번만 포크한다', async () => {
    const { useCase } = setup()
    expect(await useCase.startFork('guunmong', 2, { ...input, dir: ' ' })).toEqual({ error: '무엇이 달라지는지 한 줄 적어 주세요' })
    expect(await useCase.startFork('guunmong', 2, { ...input, title: '구운몽:' })).toEqual({ error: '제목을 적어 주세요' })
    const made = await useCase.startFork('guunmong', 2, input)
    expect(made).toMatchObject({ id: expect.stringMatching(/^fork/) })
    expect((await useCase.getForm('guunmong'))?.existing?.title).toBe('구운몽: 연화봉')
    expect(await useCase.startFork('guunmong', 3, input)).toEqual({ error: '현재 이 회차는 포크할 수 없어요' })
  })

  it('설정 이력이 없는 원작은 이력 안내 동의를 요구한다', async () => {
    const { useCase } = setup()
    const form = await useCase.getForm('postman')
    expect(form?.historyConsentNeeded).toBe(true)
    expect((await useCase.getForm('guunmong'))?.historyConsentNeeded).toBe(false)
    expect(await useCase.startFork('postman', 1, { ...input, historyConsent: false })).toEqual({ error: '설정 이력 안내를 확인해 주세요' })
  })

  it('스냅샷은 분기 시점 이후 규칙·비공개 지식을 담지 않고 원작 변경을 받지 않는다', async () => {
    const { db, useCase } = setup()
    const made = await useCase.startFork('guunmong', 2, input)
    if (!('id' in made)) throw new Error(made.error)
    const original = db.works.find((w) => w.id === 'guunmong')!
    original.eps[0].t = '원작 수정'
    original.rules.push('새 규칙')
    const view = await useCase.getForked(made.id, 'user')
    expect(view?.parent?.id).toBe('guunmong')
    const snap = view!.fork.snap!
    expect(snap.eps.map((e) => e.t)).not.toContain('원작 수정')
    expect(snap.eps).toHaveLength(2)
    expect(snap.rules).not.toContain('양소유는 전생(성진)을 기억하지 못한다')
    expect(snap.rules).not.toContain('새 규칙')
    expect(snap.cast.map((c) => c.n)).not.toContain('양소유')
    expect(snap.cast.flatMap((c) => c.knowledge ?? []).every((k) => k.knownAt <= 2 && (k.publicAt ?? 99) <= 2)).toBe(true)
  })

  it('관리자도 자기가 만든 비공개 포크의 완료 화면을 보지만 남의 포크는 보지 못한다 (#605)', async () => {
    const { db, useCase } = setup()
    const made = await useCase.startFork('guunmong', 2, input)
    if (!('id' in made)) throw new Error(made.error)
    expect((await useCase.getForked(made.id, 'admin'))?.fork.id).toBe(made.id)
    db.works.find((w) => w.id === made.id)!.mine = false
    expect(await useCase.getForked(made.id, 'admin')).toBeNull()
  })

  it('새 포크에 다음 회차 작성 초안을 만든다 (목업 draftOf)', async () => {
    const { repo, useCase } = setup()
    const made = await useCase.startFork('guunmong', 2, input)
    if (!('id' in made)) throw new Error(made.error)
    expect(await repo.getDraft(made.id)).toMatchObject({ no: 3, title: '고백', paras: [], saved: true })
  })
})

/** 서버가 기준 회차까지 독자에게 공개한 카드(독자 설정 위키 응답). Fork가 이어받는 카드와 같은 집합이다(DEC-53). */
const card = (id: string, title: string, cardType: ReaderWorldCard['cardType'], revealFromEpisode = 1): ReaderWorldCard =>
  ({ id, title, text: title + ' 본문', cardType, aliases: [], tags: [], revealFromEpisode, imageId: null })
const served = (cards: ReaderWorldCard[], upto = 2, worldId: string | null = 'world-uuid'): ReaderWorldCards =>
  ({ workId: 'guunmong', worldId, upto, cards, relationships: [], relationshipStatus: 'current' })

describe('Fork 생성 미리보기: 원작에 연결된 세계관은 Fork가 이어받는 카드로 센다 (#559)', () => {
  const canonical = () => {
    const { db, repo, useCase } = setup()
    db.works.find((w) => w.id === 'guunmong')!.canonical = true
    return { repo: repo as WorkRepository, useCase }
  }

  it('고른 기준 회차로 독자 설정 위키 카드를 읽어 인물·규칙 수와 목록을 서버가 준 카드 그대로 만든다', async () => {
    const { repo, useCase } = canonical()
    const asked: [string, number | undefined][] = []
    repo.readWorldCards = async (id, upto) => { asked.push([id, upto]); return served([card('c1', '리안', 'character'), card('c2', '카엘', 'character', 2), card('c3', '봉인 규칙', 'rule'), card('c4', '별빛 탑', 'location', 2), card('c5', '별빛 능력', 'ability')]) }
    repo.readWorld = async () => { throw new Error('연결된 세계관이 있으면 레거시 설정집은 읽지 않아야 해요') }
    const form = await useCase.getForm('guunmong', 2)
    expect(asked).toEqual([['guunmong', 2]])
    expect(form?.basisEpisode).toBe(2)
    const work = form!.work
    expect(publicCast(work, 2).map((c) => c.n)).toEqual(['리안', '카엘'])
    expect(work.rules).toEqual(['봉인 규칙', '별빛 능력'])
    expect(work.wiki?.docs.map((d) => d.t)).toEqual(['리안', '카엘', '봉인 규칙', '별빛 탑', '별빛 능력'])
  })

  it('연결된 세계관이 없으면 기존 공개 설정집(readWorld)을 그대로 쓴다', async () => {
    const { repo, useCase } = canonical()
    const asked: [string, number | undefined][] = []
    const legacy: number[] = []
    repo.readWorldCards = async (id, upto) => { asked.push([id, upto]); return served([], 2, null) }
    repo.readWorld = async (w, n) => { legacy.push(n); return { ...w, rules: ['옛 규칙'] } }
    expect((await useCase.getForm('guunmong', 2))?.work.rules).toEqual(['옛 규칙'])
    expect(asked).toEqual([['guunmong', 2]])
    expect(legacy).toEqual([2])
  })

  it('서버가 다른 기준 회차의 카드를 주면 그 수를 보이지 않고 실패한다', async () => {
    const { repo, useCase } = canonical()
    repo.readWorldCards = async () => served([card('c1', '리안', 'character')], 3)
    await expect(useCase.getForm('guunmong', 2)).rejects.toThrow('기준 회차')
  })

  it('카드를 읽지 못하면 레거시 설정집으로 대신하지 않고 실패를 그대로 알린다', async () => {
    const { repo, useCase } = canonical()
    repo.readWorldCards = async () => { throw new Error('offline') }
    await expect(useCase.getForm('guunmong', 2)).rejects.toThrow('offline')
  })

  it('카드 유형을 기존 위키 분류로 옮긴다: 인물→char, 장소→place, 조직→org, 사물→item, 사건→event, 규칙·능력·기타→world', () => {
    const work = withWorldCards(createFixtureDb().works[0], served(cardTypes.map((t) => card(t.id, t.label, t.id))))
    expect(work.wiki?.docs.map((d) => d.cat)).toEqual(['char', 'place', 'org', 'world', 'item', 'world', 'event', 'world'])
    expect(work.cast.map((c) => c.n)).toEqual(['인물'])
    expect(work.rules).toEqual(['능력', '규칙', '기타'])
    expect(work.events).toEqual([])
  })
})
