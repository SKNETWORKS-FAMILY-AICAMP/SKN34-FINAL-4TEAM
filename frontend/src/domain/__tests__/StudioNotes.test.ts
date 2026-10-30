import { describe, expect, it } from 'vitest'

import { createMockDb, InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../data/mock/InMemoryRepositories'
import { FeedbackUseCase } from '../usecases/FeedbackUseCase'
import { StudioUseCase } from '../usecases/StudioUseCase'

const setup = (owned = true) => {
  const db = createMockDb()
  if (owned) {
    db.worlds.push({ id: 'my-world', name: '별빛 세계', description: '', rules: [], public: false })
    db.works.find((w) => w.id === 'starlight')!.worldIds = ['my-world']
  }
  const works = new InMemoryWorkRepository(db), feedback = new InMemoryFeedbackRepository(db)
  return { db, star: () => db.works.find((w) => w.id === 'starlight')!, useCase: new StudioUseCase(works, new InMemoryCreditRepository(db), feedback, new InMemoryWorldRepository(db)), feedback: new FeedbackUseCase(works, feedback) }
}

describe('설정 노트 (목업 data-work-setting·worldExtract·release·data-cast)', () => {
  it('세계관 자동 업데이트는 작가 소유 세계관이 있어야 켤 수 있다', async () => {
    expect(await setup(false).useCase.setSetting('starlight', 'autoWorld', true)).toBe('작가 소유 세계관이 필요해요')
    const { useCase, star } = setup()
    expect(await useCase.setSetting('starlight', 'autoWorld', true)).toBe('작품 설정을 변경했어요 (데모)')
    expect(star().settings).toEqual({ autoWorld: true, typoAuto: false })
  })

  it('autoWorld를 켜면 발행 때 첫 문단 200자를 세계관에 넣고 이력과 크레딧을 남긴다', async () => {
    const { db, useCase } = setup()
    await useCase.setSetting('starlight', 'autoWorld', true)
    const s = await useCase.open('starlight', undefined, 'user')
    if (!s || 'notMine' in s) throw new Error()
    await useCase.edit(s.key, { paras: ['가'.repeat(250), '둘째'] })
    expect(await useCase.publish('starlight', s.key, '')).toMatchObject({ ok: '4화를 공개했어요' })
    const world = db.worlds.find((w) => w.id === 'my-world')!
    expect(world.facts).toEqual([{ text: '가'.repeat(200), source: '별빛 서약의 탑', ep: 4 }])
    expect(world.history).toHaveLength(1)
    expect(db.credits.credits).toBe(95)
  })

  it('세계관 업데이트에 실패해도 발행은 되고 실패를 알린다', async () => {
    const { db, useCase } = setup()
    await useCase.setSetting('starlight', 'autoWorld', true)
    db.credits.failNext = true
    const s = await useCase.open('starlight', undefined, 'user')
    if (!s || 'notMine' in s) throw new Error()
    await useCase.edit(s.key, { paras: ['문단'] })
    expect(await useCase.publish('starlight', s.key, '')).toMatchObject({ ok: '4화는 발행됐지만 세계관 업데이트에 실패했어요' })
  })

  it('설정 추출은 후보로만 두고, 반영하면 세계관에 넣고 제외하면 지운다', async () => {
    expect(await setup(false).useCase.extractWorld('starlight', 1)).toBe('작가 소유 세계관과 발행된 회차가 필요해요')
    const { db, useCase, star } = setup()
    expect(await useCase.extractWorld('starlight', 1)).toBe('설정 후보를 확인해 주세요 (데모)')
    expect(star().worldCandidate).toEqual({ text: star().eps[0].p[0].slice(0, 200), source: '별빛 서약의 탑', ep: 1 })
    expect(await useCase.acceptWorld('starlight')).toBe('채택한 후보를 세계관에 반영했어요 (데모)')
    expect(db.worlds.find((w) => w.id === 'my-world')!.facts).toHaveLength(1)
    expect(star().worldCandidate).toBeUndefined()
    await useCase.extractWorld('starlight', 2)
    expect(await useCase.discardWorld('starlight')).toBe('후보를 제외했어요')
    expect(star().worldCandidate).toBeUndefined()
  })

  it('독자 공개 시작 회차는 1 이상만 받고, 비우거나 틀리면 비공개(Infinity)로 둔다', async () => {
    const { useCase, star } = setup()
    expect(await useCase.setRelease('starlight', 'rule', 0, '0')).toBe('1 이상의 회차를 입력해 주세요')
    expect(star().ruleFrom!['해가 지면 탑의 문은 열리지 않는다']).toBe(Infinity)
    expect(await useCase.setRelease('starlight', 'rule', 0, '2')).toBe('이 작품의 독자 공개 회차를 변경했어요 (데모)')
    expect(star().ruleFrom!['해가 지면 탑의 문은 열리지 않는다']).toBe(2)
    expect(await useCase.setRelease('starlight', 'event', 0, '1')).toBe('이 작품의 사건 공개 회차를 변경했어요 (데모)')
    expect(star().eventFrom!['탑 앞에서 밤을 지새우다']).toBe(1)
    expect(await useCase.setRelease('starlight', 'cast', 2, '')).toBe('이 작품의 인물 공개 회차를 변경했어요 (데모)')
    expect(star().castFrom!['세라핀']).toBe(Infinity)
  })

  it('인물 상태: 포크는 자기 스냅샷만 바꾼다고 알리고 원작은 원작 설정이라고 알린다', async () => {
    const { db, useCase } = setup()
    expect(await useCase.setCastStatus('starlight', 0, '결심')).toBe('원작 설정을 바꿨어요')
    db.works.find((w) => w.id === 'crown')!.owner = 'me'
    expect(await useCase.setCastStatus('crown', 0, '의문')).toBe('이 소설에서만 리안 상태를 ‘의문’로 바꿨어요 (원작 그대로)')
    expect(db.works.find((w) => w.id === 'starlight')!.cast[0].st).toBe('결심')
  })
})

describe('표기 오류 자동 승인 (목업 feedbackSheet typoAuto)', () => {
  const typo = { workId: 'starlight', n: 2, sentence: { t: '“스승님…” 리안은 낮게 되뇌였다.', pi: 2 }, type: '단순 오류' as const, text: '되뇌였다', verified: false, nick: '독자' }

  it('켜져 있으면 본문을 바로 고치고 처리 완료로 두며 피드백함에 넣지 않는다', async () => {
    const { db, useCase, feedback, star } = setup()
    await useCase.setSetting('starlight', 'typoAuto', true)
    expect(await feedback.sendFeedback(typo)).toEqual({ status: '처리 완료', message: '작품 설정의 자동 승인으로 표기 오류 수정안을 발행했어요 (데모).' })
    expect(star().eps[1].p[2]).toContain('되뇌었다')
    expect(db.inbox).toHaveLength(0)
  })

  it('꺼져 있거나 숨김 작품이면 작가 검토로 보낸다', async () => {
    const { db, useCase, feedback } = setup()
    expect((await feedback.sendFeedback(typo)).status).toBe('작가 검토 대기')
    await useCase.setSetting('starlight', 'typoAuto', true)
    db.works.find((w) => w.id === 'starlight')!.hidden = true
    expect((await feedback.sendFeedback(typo)).status).toBe('작가 검토 대기')
    expect(db.inbox).toHaveLength(2)
  })
})
