import { describe, expect, it } from 'vitest'

import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../data/mock/InMemoryRepositories'
import { StudioUseCase } from '../usecases/StudioUseCase'

const setup = () => {
  const db = createFixtureDb(), workRepository = new InMemoryWorkRepository(db)
  const starlight = () => db.works.find((w) => w.id === 'starlight')!
  return { db, workRepository, starlight, useCase: new StudioUseCase(workRepository, new InMemoryCreditRepository(db), new InMemoryFeedbackRepository(db), new InMemoryWorldRepository(db)) }
}
const opened = async (u: StudioUseCase) => {
  const s = await u.open('starlight', undefined, 'user')
  if (!s || 'notMine' in s) throw new Error('not opened')
  return s
}

describe('집필실 목업 모드 보완 (#36·#7)', () => {
  it('설정 검사는 문장이 어긴 규칙을 표시한다 (첫 번째 규칙이 아니어도)', async () => {
    const { db, starlight, useCase } = setup()
    starlight().rules.reverse() // 문 규칙이 두 번째
    const s = await opened(useCase)
    await useCase.edit(s.key, { paras: ['해가 진 뒤 탑의 문이 열렸다.'] })
    await useCase.check('starlight', s.key)
    expect(db.drafts.starlight.check?.issues).toMatchObject([{ rule: '해가 지면 탑의 문은 열리지 않는다' }])
  })

  it('중단된 자율 연재를 다시 시작하면 실패 횟수를 0으로 되돌린다', async () => {
    const { starlight, useCase } = setup()
    starlight().auto = { on: true, status: '중단됨', react: true, requireReview: false, log: [], failures: 3 }
    await useCase.pauseAuto('starlight')
    expect(starlight().auto).toMatchObject({ status: '실행 중', failures: 0 })
  })

  it('자율 연재를 껐다 다시 켜도 실패 횟수를 0으로 되돌린다', async () => {
    const { starlight, useCase } = setup()
    starlight().auto = { on: true, status: '중단됨', react: true, requireReview: false, log: [], failures: 3 }
    await useCase.toggleAuto('starlight')
    await useCase.toggleAuto('starlight')
    expect(starlight().auto).toMatchObject({ on: true, status: '실행 중', failures: 0 })
  })

  it('세계관은 WorkRepository.listWorlds가 비어 있어도(Http 구현) WorldRepository로 찾는다', async () => {
    const { starlight, workRepository, useCase } = setup()
    workRepository.listWorlds = async () => []
    starlight().worldIds = ['shared-world']
    expect((await opened(useCase)).shared).toMatchObject({ id: 'shared-world' })
    await useCase.addDoc('starlight', 'world', '밤에는 항구의 문이 닫힌다')
    expect(starlight().localRules).not.toContain('밤에는 항구의 문이 닫힌다')
    expect(await useCase.savePublishSettings('starlight', { vis: '모두', on: true, all: true, eps: [], kind: '자체 창작', ok: true })).toEqual({ ok: '공개 설정을 저장했어요 · 전체 회차 포크 허용' })
  })
})
