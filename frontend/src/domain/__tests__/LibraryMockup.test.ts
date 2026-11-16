import { expect, it } from 'vitest'

import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryFeedbackRepository, InMemoryReadingRecordRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../data/mock/InMemoryRepositories'
import { InMemoryWorkInterestRepository } from '../../data/mock/InMemoryWorkInterestRepository'
import { LibraryUseCase } from '../usecases/LibraryUseCase'

const setup = () => {
  const db = createFixtureDb()
  return { db, useCase: new LibraryUseCase(new InMemoryWorkRepository(db), new InMemoryWorldRepository(db), new InMemoryFeedbackRepository(db), new InMemoryWorkInterestRepository(), new InMemoryReadingRecordRepository(db)) }
}

// #30: 목업(메모리 저장소)에서도 UseCase가 소유권·공개 범위 불변식을 직접 지킨다.
it('남의 세계관은 수정·복원·삭제하지 못하고 조합도 남의 비공개 규칙을 가져오지 못한다', async () => {
  const { db, useCase } = setup()
  db.worlds.push({
    id: 'theirs', name: '타인 세계', description: '', rules: ['공개 규칙', '비공개 규칙'], public: true, owner: '다른 작가', allowUse: true, allowFork: true,
    rulePublic: { '공개 규칙': true, '비공개 규칙': false }, history: [{ name: '타인 세계', description: '', rules: ['옛 규칙'], public: true }],
  })
  const before = structuredClone(db.worlds)
  expect(await useCase.editWorld('shared-world', { name: '탈취', description: '', rules: '바뀐 규칙' }, true)).toEqual({ error: '내 세계관만 수정할 수 있어요' })
  expect(await useCase.restoreWorld('theirs', 0)).toEqual({ error: '복원할 수 있는 세계관 버전이 없어요' })
  expect(await useCase.deleteWorld('shared-world')).toEqual({ error: '내 세계관만 삭제할 수 있어요' })
  expect(db.worlds).toEqual(before)
  const combined = await useCase.combineWorlds('조합', [{ worldId: 'theirs', ruleIndex: 0 }, { worldId: 'theirs', ruleIndex: 1 }])
  if (!('id' in combined)) throw new Error(combined.error)
  expect(db.worlds.find((w) => w.id === combined.id)!.rules).toEqual(['공개 규칙'])
})

// #31: 가져오기 정리 결과를 사용자가 고친 뒤 저장해도 빈 인물·NaN 사건이 남지 않는다.
it('가져오기 저장은 빈 항목을 버리고 두 자리 회차를 읽으며 형식이 틀린 사건은 거부한다', async () => {
  const { db, useCase } = setup()
  const made = await useCase.createWorld({ name: '남원', description: '', rules: '' })
  if (!('id' in made)) throw new Error(made.error)
  const input = { kind: '자체 창작', worldId: made.id, world: [] }
  expect(await useCase.saveImport({ ...input, cast: ['춘향 · 주인공'], events: ['4화 암행어사 출두', '암행어사 출두'] })).toEqual({ error: "사건은 'N화 내용' 형식으로 적어 주세요" })
  expect(await useCase.saveImport({ ...input, cast: ['춘향 · 주인공'], events: ['3화'] })).toEqual({ error: "사건은 'N화 내용' 형식으로 적어 주세요" })
  expect(db.works.some((w) => w.id === 'chunhyang')).toBe(false)
  expect(await useCase.saveImport({ ...input, cast: ['춘향 · 주인공', ''], events: ['10화 암행어사 출두', ''] })).toEqual({ ok: true })
  const work = db.works.find((w) => w.id === 'chunhyang')!
  expect(work.cast.map((c) => c.n)).toEqual(['춘향'])
  expect(Object.keys(work.castFrom!)).toEqual(['춘향'])
  expect(work.events).toEqual([[10, 'm', '암행어사 출두', []]])
})
