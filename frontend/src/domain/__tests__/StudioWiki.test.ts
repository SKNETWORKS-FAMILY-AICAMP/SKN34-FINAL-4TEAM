import { describe, expect, it } from 'vitest'

import { createMockDb, InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { linkParts, wikiState } from '../entities/wiki'
import { makeFork } from '../entities/work'
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
    const docs = wikiState(w()).docs
    const parts = linkParts(docs, '리안이 별빛 탑에서 리안을 불렀다', 'x')
    expect(parts.map((p) => (typeof p === 'string' ? p : '[' + p.t + ']'))).toEqual(['[리안]', '이 ', '[별빛 탑]', '에서 리안을 불렀다'])
  })
  it('규칙은 세계관 문서의 제목·종류 값·생성·삭제 때만 다시 만들고, 속성 추가는 값만 넣는다', async () => {
    const { useCase, w } = await setup()
    const rule = w().rules[0]
    const doc = () => w().wiki!.docs.find((d) => d.cat === 'world' && d.t === rule)!
    await useCase.renameDocProp('starlight', doc().id, '종류', '분류')
    expect(w().rules).toContain(rule)
    w().rules = []
    await useCase.addDocProp('starlight', doc().id, '종류', '규칙')
    expect(w().rules).toEqual([])
    await useCase.setDocText('starlight', doc().id, 't', '바뀐 규칙')
    expect(w().rules).toContain('바뀐 규칙')
    const lian = w().wiki!.docs.find((d) => d.t === '리안')!.id
    await useCase.addDocProp('starlight', lian, '상태', '잠듦')
    expect(w().cast.find((c) => c.n === '리안')!.st).toBe('결의')
  })

  it('세계관 종류 값을 바꾸면 규칙에서 빠진다', async () => {
    const { useCase, w } = await setup()
    const rule = w().rules[0]
    const d = w().wiki!.docs.find((x) => x.cat === 'world' && x.t === rule)!
    await useCase.setDocProp('starlight', d.id, '종류', '설명')
    expect(w().rules).not.toContain(rule)
  })

  it('인물 제목을 바꾸면 castFrom도 옮겨진다', async () => {
    const { useCase, w } = await setup()
    w().castFrom = { 리안: 1 }
    await useCase.setDocText('starlight', w().wiki!.docs.find((d) => d.t === '리안')!.id, 't', '리아나')
    expect(w().castFrom).toEqual({ 리아나: 1 })
  })

  it('사건 제목을 바꾼 뒤 다시 열어도 문서 ID가 모두 고유하다', async () => {
    const { useCase, w } = await setup()
    const ev = w().wiki!.docs.find((d) => d.cat === 'event')!
    await useCase.setDocText('starlight', ev.id, 't', '새 사건 제목')
    await useCase.open('starlight', undefined, 'user')
    const ids = w().wiki!.docs.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(w().wiki!.docs.find((d) => d.id === ev.id)!.t).toBe('새 사건 제목')
  })

  it('없는 문서는 지우지 않고 null을 돌려준다', async () => {
    const { useCase } = await setup()
    expect(await useCase.deleteDoc('starlight', 'none')).toBeNull()
  })

  it('포크 작품에서도 사전을 만든다', async () => {
    const { db, useCase } = await setup()
    db.works.push(makeFork(db.works.find((x) => x.id === 'guunmong')!, 2, { id: 'fk', title: '포크', author: '나', owner: 'me' }))
    const s = await useCase.open('fk', undefined, 'user')
    expect(s && 'work' in s && s.work.wiki!.docs.some((d) => d.t === '성진')).toBe(true)
  })
})
