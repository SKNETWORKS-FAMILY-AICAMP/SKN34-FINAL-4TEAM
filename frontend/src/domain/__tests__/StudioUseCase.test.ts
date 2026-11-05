import { describe, expect, it } from 'vitest'

import { createMockDb, InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../data/mock/InMemoryRepositories'
import { StudioUseCase } from '../usecases/StudioUseCase'

const setup = () => {
  const db = createMockDb()
  return { db, useCase: new StudioUseCase(new InMemoryWorkRepository(db), new InMemoryCreditRepository(db), new InMemoryFeedbackRepository(db), new InMemoryWorldRepository(db)) }
}
const opened = async (u: StudioUseCase, id: string, ep?: number) => {
  const s = await u.open(id, ep, 'user')
  if (!s || 'notMine' in s) throw new Error('not opened')
  return s
}

describe('StudioUseCase (목업 studio()·draftOf·pubEpSheet)', () => {
  it('남의 소설은 열지 않고, 발행 회차는 수정 초안(starlight:ep:1)으로 연다', async () => {
    const { db, useCase } = setup()
    expect(await useCase.open('guunmong', undefined, 'user')).toMatchObject({ notMine: true })
    const s = await opened(useCase, 'starlight', 1)
    expect(s.key).toBe('starlight:ep:1')
    const original = db.works.find((w) => w.id === 'starlight')!.eps[0].p.slice()
    await useCase.edit(s.key, { paras: ['수정 초안'] })
    expect(db.drafts['starlight:ep:1'].paras).toEqual(['수정 초안'])
    expect(db.works.find((w) => w.id === 'starlight')!.eps[0].p).toEqual(original)
    expect(await useCase.publish('starlight', s.key, '')).toEqual({ ok: '1화 수정안을 발행했어요 (데모)', go: '/studio/starlight?ep=1' })
    expect(db.works.find((w) => w.id === 'starlight')!.eps[0].p).toEqual(['수정 초안'])
  })

  it('AI 제안은 승인해야 원고에 들어가고 버리면 그대로다', async () => {
    const { useCase } = setup()
    const s = await opened(useCase, 'starlight')
    await useCase.propose(s.key, '긴장감 있게')
    let d = (await opened(useCase, 'starlight')).draft
    expect(d).toMatchObject({ proposal: 'shown', aiPrompt: '긴장감 있게', paras: [] })
    await useCase.dropProposal(s.key)
    expect((await opened(useCase, 'starlight')).draft.paras).toEqual([])
    await useCase.propose(s.key, '')
    await useCase.acceptProposal('starlight', s.key)
    d = (await opened(useCase, 'starlight')).draft
    expect(d.paras).toEqual(['리안은 한동안 말없이 창밖을 바라보았다.', '“이제는 피할 수 없어.” 리안이 낮게 말했다.', '카엘은 대답 대신 천천히 고개를 끄덕였다.'])
  })

  it('설정 검사는 규칙과 어긋난 문장을 찾고 제안대로 고치거나 무시한다', async () => {
    const { db, useCase } = setup()
    const made = await useCase.open('starlight', undefined, 'user')
    if (!made || 'notMine' in made) throw new Error()
    await useCase.edit(made.key, { paras: ['해가 진 뒤 탑의 문이 열렸다.'] })
    expect(await useCase.check('starlight', made.key)).toBe(1)
    expect(db.drafts.starlight.check).toMatchObject({ stale: false, issues: [{ rule: '해가 지면 탑의 문은 열리지 않는다' }] })
    await useCase.fix('starlight', made.key, 0)
    expect(db.drafts.starlight.paras).toEqual(['해가 진 뒤라 문은 열리지 않았다.'])
    await useCase.edit(made.key, { paras: ['바뀐 문장'] })
    expect(db.drafts.starlight.check).toMatchObject({ stale: true })
  })

  it('새 회차 공개는 원고가 있어야 하고, 회차 공개 중단을 토글한다', async () => {
    const { db, useCase } = setup()
    const s = await opened(useCase, 'starlight')
    expect(await useCase.publish('starlight', s.key, '')).toEqual({ error: '소설을 먼저 써 주세요' })
    await useCase.edit(s.key, { paras: ['새 문단'], title: '새 회차' })
    const n = db.works.find((w) => w.id === 'starlight')!.eps.length + 1
    expect(await useCase.publish('starlight', s.key, '제목')).toEqual({ ok: `${n}화를 공개했어요`, go: '/work/starlight' })
    expect(await useCase.toggleEpisode('starlight', 0)).toBe('이 회차의 공개를 중단했어요 (데모)')
    expect(db.works.find((w) => w.id === 'starlight')!.eps[0].hidden).toBe(true)
  })

  it('TXT는 현재 회차 또는 전체 원고를 BOM 포함 텍스트로 만든다', async () => {
    const { useCase } = setup()
    const s = await opened(useCase, 'starlight')
    await useCase.edit(s.key, { paras: ['가', '나'], title: '새 회차' })
    const one = await useCase.exportText('starlight', s.key, false)
    expect(one.name).toMatch(/^별빛 서약의 탑_\d+화\.txt$/)
    expect(one.content).toMatch(/화 새 회차\n\n가\n\n나$/)
    const all = await useCase.exportText('starlight', s.key, true)
    expect(all.content.startsWith('별빛 서약의 탑\n\n1화 ')).toBe(true)
    expect(all.name).toBe('별빛 서약의 탑_전체원고.txt')
  })
})

describe('AI 자율 연재 (목업 act==="autoGen")', () => {
  it('데모 실패가 3번 이어지면 중단하고, 성공하면 실패 횟수를 되돌린다', async () => {
    const { db, useCase } = setup()
    await useCase.toggleAuto('starlight')
    for (let i = 0; i < 3; i++) {
      db.credits.failNext = true
      await useCase.autoGen('starlight', () => true)
    }
    const w = db.works.find((x) => x.id === 'starlight')!
    expect(w.auto).toMatchObject({ failures: 3, status: '중단됨' })
    expect(await useCase.autoGen('starlight', () => true)).toBe('자율 연재를 다시 시작해 주세요')
    await useCase.pauseAuto('starlight')
    const n = db.works.find((x) => x.id === 'starlight')!.eps.length
    expect(await useCase.autoGen('starlight', () => true)).toBe(`AI가 ${n + 1}화를 쓰고 공개했어요 (데모)`)
    expect(db.works.find((x) => x.id === 'starlight')!.auto?.failures).toBe(0)
  })
})
