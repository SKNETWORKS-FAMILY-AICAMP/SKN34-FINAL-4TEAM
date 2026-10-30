import { describe, expect, it } from 'vitest'

import { createMockDb, InMemoryFeedbackRepository, InMemoryReadingRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../data/mock/InMemoryRepositories'
import { LibraryUseCase, NOVEL_GENRES, type NewWorkInput } from '../usecases/LibraryUseCase'

const setup = () => {
  const db = createMockDb()
  return { db, useCase: new LibraryUseCase(new InMemoryWorkRepository(db), new InMemoryWorldRepository(db), new InMemoryReadingRepository(db), new InMemoryFeedbackRepository(db)) }
}
const base = (worldIds: string[]): NewWorkInput => ({
  worldIds, schedule: ['비정기'], tags: ['회귀', '성장'], title: '안개 등대', summary: '', localRules: '등대는 밤에 꺼진다',
  cast: [{ n: '노인', d: '' }, { n: '', d: '' }, { n: '', d: '' }], genre: 'SF', rating: '일반', fork: 'all', cover: null,
})

describe('LibraryUseCase · 새 소설 (목업 createWork)', () => {
  it('장르 목록은 목업 NOVEL_GENRES 30개다', () => {
    expect(NOVEL_GENRES).toHaveLength(30)
    expect(NOVEL_GENRES.slice(0, 3)).toEqual(['판타지', '현대판타지', '무협'])
  })

  it('세계관 0·6개, 요일 없음, 태그 1개, 제목·인물 없음을 차례로 거부한다', async () => {
    const { useCase } = setup()
    expect(await useCase.createWork(base([]))).toEqual({ error: '세계관을 1~5개 선택해 주세요' })
    expect(await useCase.createWork(base(['a', 'b', 'c', 'd', 'e', 'f']))).toEqual({ error: '세계관을 1~5개 선택해 주세요' })
    expect(await useCase.createWork({ ...base(['shared-world']), schedule: [] })).toEqual({ error: '연재 요일 또는 비정기 연재를 선택해 주세요' })
    expect(await useCase.createWork({ ...base(['shared-world']), tags: ['하나'] })).toEqual({ error: '태그를 2개 이상 추가해 주세요' })
    expect(await useCase.createWork({ ...base(['shared-world']), title: ' ' })).toEqual({ error: '제목을 적어 주세요' })
    expect(await useCase.createWork({ ...base(['shared-world']), cast: [{ n: ' ', d: '' }] })).toEqual({ error: '인물을 1명 이상 적어 주세요' })
    expect(await useCase.createWork(base(['nope']))).toEqual({ error: '이용할 수 없는 세계관이 있어요' })
  })

  it('비공개 원작을 만들고 공개 세계관은 공개 규칙만 가져온다', async () => {
    const { db, useCase } = setup()
    const made = await useCase.createWork(base(['shared-world']))
    if (!('id' in made)) throw new Error(made.error)
    const w = db.works.find((x) => x.id === made.id)!
    expect(w).toMatchObject({ private: true, theme: 'neon', owner: 'me', forkAll: true, forksAllowed: true, hash: ['#회귀', '#성장'], summary: '아직 소개가 없어요.' })
    expect(w.rules).toEqual(['밤에는 항구의 문이 닫힌다', '등대는 밤에 꺼진다'])
    const off = await useCase.createWork({ ...base(['shared-world']), fork: '0' })
    if (!('id' in off)) throw new Error(off.error)
    expect(db.works.find((x) => x.id === off.id)!.forksAllowed).toBe(false)
  })
})

describe('LibraryUseCase · 세계관 (목업 worldManager·saveWorld)', () => {
  it('만들기·편집은 이력을 남기고 복원할 수 있으며 연결 작품이 있으면 삭제를 거부한다', async () => {
    const { db, useCase } = setup()
    expect(await useCase.createWorld({ name: ' ', description: '', rules: '' })).toEqual({ error: '세계관 이름을 적어 주세요' })
    const made = await useCase.createWorld({ name: '새 세계', description: '', rules: '밤에는 문이 닫힌다\n밤에는 문이 닫힌다\n' })
    if (!('id' in made)) throw new Error(made.error)
    const world = () => db.worlds.find((x) => x.id === made.id)!
    expect(world()).toMatchObject({ rules: ['밤에는 문이 닫힌다'], public: false })
    expect(world().history).toHaveLength(1)
    const work = await useCase.createWork(base([made.id]))
    if (!('id' in work)) throw new Error(work.error)
    expect(await useCase.editWorld(made.id, { name: '새 세계', description: '', rules: '새벽에 문이 열린다' }, false)).toEqual({ needsConfirm: true })
    expect(await useCase.editWorld(made.id, { name: '새 세계', description: '', rules: '새벽에 문이 열린다' }, true)).toEqual({ ok: true })
    const linked = () => db.works.find((x) => x.id === work.id)!
    expect(linked().rules).toEqual(['등대는 밤에 꺼진다', '새벽에 문이 열린다'])
    expect(linked().rules).not.toContain('밤에는 문이 닫힌다')
    expect(world().history).toHaveLength(2)
    await useCase.restoreWorld(made.id, 0)
    expect(world().rules).toEqual(['밤에는 문이 닫힌다'])
    expect(linked().rules).toContain('밤에는 문이 닫힌다')
    expect(await useCase.deleteWorld(made.id)).toEqual({ error: '연결된 작품이 있어 삭제할 수 없어요' })
    const lone = await useCase.createWorld({ name: '혼자', description: '', rules: '' })
    if (!('id' in lone)) throw new Error(lone.error)
    expect(await useCase.deleteWorld(lone.id)).toEqual({ ok: true })
  })

  it('공개 전환·항목 공개·허용 범위·조합·복사는 내 세계관에만 적용된다', async () => {
    const { db, useCase } = setup()
    const made = await useCase.createWorld({ name: '내 세계', description: '', rules: '규칙 하나\n규칙 둘' })
    if (!('id' in made)) throw new Error(made.error)
    await useCase.togglePublic(made.id)
    await useCase.setRulePublic(made.id, 1, true)
    await useCase.setPermission(made.id, 'allowFork', true)
    await useCase.setPermission('shared-world', 'allowAI', true)
    const w = db.worlds.find((x) => x.id === made.id)!
    expect(w).toMatchObject({ public: true, rulePublic: { '규칙 둘': true }, allowFork: true })
    expect(db.worlds.find((x) => x.id === 'shared-world')!.allowAI).toBe(false)
    expect(await useCase.combineWorlds('', [{ worldId: made.id, ruleIndex: 0 }])).toEqual({ error: '이름과 항목을 선택해 주세요' })
    const combined = await useCase.combineWorlds('조합', [{ worldId: made.id, ruleIndex: 0 }, { worldId: 'shared-world', ruleIndex: 0 }])
    if (!('id' in combined)) throw new Error(combined.error)
    expect(db.worlds.find((x) => x.id === combined.id)).toMatchObject({ rules: ['규칙 하나', '밤에는 항구의 문이 닫힌다'], sources: [{ id: 'shared-world', owner: '예시 작가' }] })
    const copied = await useCase.copyWorld('shared-world')
    if (!copied) throw new Error('copy')
    expect(db.worlds.find((x) => x.id === copied.id)).toMatchObject({ name: '안개 항구 포크', public: false, source: { id: 'shared-world' } })
  })
})

describe('LibraryUseCase · 가져오기와 서재', () => {
  it('가져오기는 내 세계관이 있어야 저장되고 한 번만 저장된다', async () => {
    const { db, useCase } = setup()
    expect(await useCase.saveImport({ kind: '다른 사람 소설', worldId: 'shared-world' })).toEqual({ error: '연결할 내 세계관을 선택해 주세요' })
    const made = await useCase.createWorld({ name: '남원', description: '', rules: '' })
    if (!('id' in made)) throw new Error(made.error)
    expect(await useCase.saveImport({ kind: '다른 사람 소설', worldId: made.id })).toEqual({ ok: true })
    expect(db.works.find((w) => w.id === 'chunhyang')).toMatchObject({ rights: '미확인', forksAllowed: false, private: true })
    expect(await useCase.saveImport({ kind: '자체 창작', worldId: made.id })).toEqual({ error: '이미 저장했어요' })
  })

  it('내가 쓰는 소설에 포크·원작과 초안 상태를 보여 준다', async () => {
    const { useCase } = setup()
    const write = await useCase.getWrite()
    expect(write.mine.map((m) => m.work.id)).toEqual(expect.arrayContaining(['starlight']))
    const read = await useCase.getRead()
    expect(read.recent.map((r) => [r.work.id, r.n])).toEqual([['guunmong', 2], ['starlight', 1]])
  })
})
