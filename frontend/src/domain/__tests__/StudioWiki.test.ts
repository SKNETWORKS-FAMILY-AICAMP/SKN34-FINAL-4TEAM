import { describe, expect, it } from 'vitest'

import { createMockDb, InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { linkParts, wikiOf } from '../entities/wiki'
import { StudioUseCase } from '../usecases/StudioUseCase'

const setup = async () => {
  const db = createMockDb()
  const useCase = new StudioUseCase(new InMemoryWorkRepository(db), new InMemoryCreditRepository(db), new InMemoryFeedbackRepository(db))
  await useCase.open('starlight', undefined, 'user')
  const w = () => db.works.find((x) => x.id === 'starlight')!
  return { db, useCase, w }
}

describe('집필실 사전 (목업 wikiOf·wnew·wdel·data-wf·linkify)', () => {
  it('처음 열 때 사전을 작품에 저장하고, 고친 내용은 다시 열어도 남는다', async () => {
    const { useCase, w } = await setup()
    expect(w().wiki?.cats.map((c) => c.id)).toContain('char')
    const id = w().wiki!.docs.find((d) => d.t === '리안')!.id
    await useCase.setDocText('starlight', id, 'body', '새 본문')
    await useCase.setDocProp('starlight', id, '상태', '각성')
    await useCase.renameDocProp('starlight', id, '말투', '어투')
    await useCase.open('starlight', undefined, 'user')
    const d = w().wiki!.docs.find((x) => x.id === id)!
    expect(d).toMatchObject({ body: '새 본문', props: { 상태: '각성', 어투: '존댓말' } })
    expect(w().cast.find((c) => c.n === '리안')!.st).toBe('각성')
  })

  it('새 인물 문서는 등장인물에 추가되고, 제목을 바꾸면 인물 이름도 바뀐다', async () => {
    const { useCase, w } = await setup()
    const id = (await useCase.addDoc('starlight', 'char', '미르'))!
    expect(w().cast.some((c) => c.n === '미르')).toBe(true)
    await useCase.setDocText('starlight', id, 't', '미르아')
    expect(w().cast.some((c) => c.n === '미르아')).toBe(true)
    await useCase.setDocText('starlight', id, 't', '')
    expect(w().wiki!.docs.find((d) => d.id === id)!.t).toBe('미르아')
  })

  it('세계관 문서를 추가·삭제하면 규칙이 다시 만들어지고, 지운 사건은 연결에서도 빠진다', async () => {
    const { useCase, w } = await setup()
    const id = (await useCase.addDoc('starlight', 'world', '새 규칙'))!
    expect(w().rules).toContain('새 규칙')
    expect(await useCase.deleteDoc('starlight', id)).toBe('world')
    expect(w().rules).not.toContain('새 규칙')
    const target = w().wiki!.docs.find((d) => d.t === '봉인 아래의 속삭임')!
    await useCase.deleteDoc('starlight', target.id)
    expect(w().wiki!.docs.some((d) => d.links?.some((l) => l.to === target.id))).toBe(false)
  })

  it('별칭·태그·분류를 추가하고 별칭을 지운다', async () => {
    const { useCase, w } = await setup()
    const id = w().wiki!.docs[0].id
    await useCase.addDocChip('starlight', id, 'alias', '견습생')
    await useCase.addDocChip('starlight', id, 'tags', '주인공')
    await useCase.addCategory('starlight', '마법')
    expect(w().wiki!.docs[0]).toMatchObject({ alias: ['견습생'], tags: ['주인공'] })
    expect(w().wiki!.cats.at(-1)!.n).toBe('마법')
    await useCase.removeAlias('starlight', id, 0)
    expect(w().wiki!.docs[0].alias).toEqual([])
  })

  it('linkParts는 다른 문서 제목의 첫 번째만, 긴 제목을 먼저 연결한다', async () => {
    const { w } = await setup()
    const docs = wikiOf(w())
    const parts = linkParts(docs, '리안이 별빛 탑에서 리안을 불렀다', 'x')
    expect(parts.map((p) => (typeof p === 'string' ? p : '[' + p.t + ']'))).toEqual(['[리안]', '이 ', '[별빛 탑]', '에서 리안을 불렀다'])
  })
})
