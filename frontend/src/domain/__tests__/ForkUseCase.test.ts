import { describe, expect, it } from 'vitest'

import { createMockDb, InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { ForkUseCase } from '../usecases/ForkUseCase'

const setup = () => {
  const db = createMockDb()
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
    expect(view?.parent.id).toBe('guunmong')
    const snap = view!.fork.snap!
    expect(snap.eps.map((e) => e.t)).not.toContain('원작 수정')
    expect(snap.eps).toHaveLength(2)
    expect(snap.rules).not.toContain('양소유는 전생(성진)을 기억하지 못한다')
    expect(snap.rules).not.toContain('새 규칙')
    expect(snap.cast.map((c) => c.n)).not.toContain('양소유')
    expect(snap.cast.flatMap((c) => c.knowledge ?? []).every((k) => k.knownAt <= 2 && (k.publicAt ?? 99) <= 2)).toBe(true)
  })

  it('새 포크에 다음 회차 작성 초안을 만든다 (목업 draftOf)', async () => {
    const { repo, useCase } = setup()
    const made = await useCase.startFork('guunmong', 2, input)
    if (!('id' in made)) throw new Error(made.error)
    expect(await repo.getDraft(made.id)).toMatchObject({ no: 3, title: '고백', paras: [], saved: true })
  })
})
