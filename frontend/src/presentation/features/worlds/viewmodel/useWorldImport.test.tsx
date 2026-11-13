// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../../test/testLocks'
import { login } from '../../../../data/api/auth'
import { HttpWorldStudioRepository } from '../../../../data/world-studio/HttpWorldStudioRepository'
import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import { newSetting, type StudioSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { useWorldImport } from './useWorldImport'

afterEach(cleanup)

const source: PublicWorld = {
  id: 'src', name: '별빛 세계', description: '', genre: 'fantasy', authorNickname: '윤서하', publishedAt: '2026-11-01T00:00:00Z', revisionNo: 3, relationshipStatus: 'current',
  cards: [
    { id: 'c1', title: '리안', text: '끈질긴 견습생', cardType: 'character', aliases: ['견습 서약사'], tags: ['주인공'] },
    { id: 'c2', title: '별빛 탑', text: '봉인을 지키는 탑', cardType: 'location', aliases: [], tags: [] },
    { id: 'c3', title: '봉인 규칙', text: '해가 지면 문이 닫힌다', cardType: 'rule', aliases: [], tags: [] },
  ],
  relationships: [{ id: 'r1', sourceCardId: 'c1', targetCardId: 'c3', label: '지키는 규칙' }],
}
const setting = (title: string): StudioSetting => { const base = newSetting(); return { ...base, item: { ...base.item, kind: 'entity', entityType: 'character', title, text: `${title} 설명` } } }
const mine = (settings: StudioSetting[] = [setting('기존 설정')]): StudioWorld => ({ id: 'mine', name: '내 세계', description: '', version: 4, settings, analysis: null })
/** 내 세계관 UseCase 대역: 읽기는 준 초안을, 저장은 버전을 올린 결과를 돌려준다. */
const fake = (world = mine()) => ({ read: vi.fn(async (_id: string) => world), save: vi.fn(async (saved: StudioWorld) => ({ ...saved, version: saved.version + 1 })) })
type Studio = Parameters<typeof useWorldImport>[1]
const TARGET = { id: 'mine', name: '내 세계' }
const open = (useCase: Studio) => renderHook(() => useWorldImport(source, useCase)).result
/** 훅을 열어 한 번 더하고 끝난 결과를 돌려준다. */
async function addOnce(useCase: Studio, cardIds: string[]) {
  const result = open(useCase)
  let ok = false
  await act(async () => { ok = await result.current.add(TARGET, cardIds) })
  return { ok, outcome: result.current.outcome }
}

describe('공개 설정을 내 세계관 초안에 바로 더하기 (DEC-46)', () => {
  it('대상의 최신 초안을 읽어 고른 설정만 새 카드로 끝에 붙여 저장하고 대상과 더한 수를 알린다', async () => {
    const world = mine()
    const useCase = fake(world)
    expect(await addOnce(useCase, ['c1', 'c3'])).toEqual({ ok: true, outcome: { status: 'done', target: TARGET, count: 2 } })
    expect(useCase.read).toHaveBeenCalledWith('mine')
    const [saved] = useCase.save.mock.calls[0]
    expect(saved).toMatchObject({ id: 'mine', name: '내 세계', version: 4 })
    expect(saved.settings[0]).toEqual(world.settings[0])
    const added = saved.settings.slice(1)
    expect(added.map((s) => [s.item.title, s.item.text, s.aliases, s.tags])).toEqual([['리안', '끈질긴 견습생', ['견습 서약사'], ['주인공']], ['봉인 규칙', '해가 지면 문이 닫힌다', [], []]])
    // 새 id · 비공개 · 독자 공개 회차 없음 · 출처 기록. 관계는 함께 오지 않는다.
    for (const s of added) {
      expect(['c1', 'c3']).not.toContain(s.item.id)
      expect(s.visibility).toBeUndefined()
      expect(s.revealFromEpisode).toBeUndefined()
    }
    expect(added.map((s) => s.importedFrom)).toEqual([
      { worldId: 'src', worldName: '별빛 세계', authorNickname: '윤서하', revisionNo: 3, cardId: 'c1' },
      { worldId: 'src', worldName: '별빛 세계', authorNickname: '윤서하', revisionNo: 3, cardId: 'c3' },
    ])
    expect(saved.settings.some((s) => s.item.kind === 'relation')).toBe(false)
  })

  it('고른 설정이 원본에 없으면 대상 세계관을 읽지 않고 알린다', async () => {
    const useCase = fake()
    expect(await addOnce(useCase, ['gone'])).toMatchObject({ ok: false, outcome: { status: 'failed', message: expect.stringContaining('가져올 설정을 찾을 수 없어요') } })
    expect(useCase.read).not.toHaveBeenCalled()
  })

  it('대상 세계관을 읽지 못하거나 저장이 거절되면 서버 사유 그대로 실패로 알리고 성공으로 바꾸지 않는다', async () => {
    const unread = fake()
    unread.read.mockRejectedValue(new Error('세계관을 찾을 수 없습니다.'))
    expect(await addOnce(unread, ['c1'])).toEqual({ ok: false, outcome: { status: 'failed', target: TARGET, message: '세계관을 찾을 수 없습니다.' } })
    expect(unread.save).not.toHaveBeenCalled()
    const conflict = fake()
    conflict.save.mockRejectedValue(new Error('저장되지 않았습니다. 최신 상태를 다시 조회하세요.'))
    expect(await addOnce(conflict, ['c1'])).toEqual({ ok: false, outcome: { status: 'failed', target: TARGET, message: '저장되지 않았습니다. 최신 상태를 다시 조회하세요.' } })
  })

  it('활성 설정이 1,000개 한도를 넘으면 저장하지 않고 남은 자리를 알린다', async () => {
    const useCase = fake(mine(Array.from({ length: 999 }, (_, i) => setting(`설정 ${i}`))))
    expect((await addOnce(useCase, ['c1', 'c2'])).outcome).toMatchObject({ status: 'failed', message: expect.stringContaining('지금은 1개까지 가져올 수 있어요.') })
    expect(useCase.save).not.toHaveBeenCalled()
  })

  it('추가하는 동안 다시 눌러도 한 번만 보내고 그동안은 추가하는 중으로 알린다', async () => {
    const useCase = fake()
    let finish!: () => void
    useCase.save.mockImplementation((saved) => new Promise((done) => { finish = () => done({ ...saved, version: 5 }) }))
    const result = open(useCase)
    expect(result.current.outcome).toBeUndefined()
    let first!: Promise<boolean>
    await act(async () => { first = result.current.add(TARGET, ['c1', 'c2']) })
    expect(result.current.outcome).toEqual({ status: 'saving', target: TARGET, count: 2 })
    let second = true
    await act(async () => { second = await result.current.add(TARGET, ['c1', 'c2']) })
    expect(second).toBe(false)
    await act(async () => { finish(); await first })
    expect(useCase.save).toHaveBeenCalledTimes(1)
    expect(result.current.outcome).toEqual({ status: 'done', target: TARGET, count: 2 })
  })
})

describe('가져오기 다시 시도 (저장 결과를 모르는 실패 뒤)', () => {
  it('대상을 다시 읽어 초안이 그대로면 보냈던 입력을 그대로 다시 보낸다', async () => {
    const useCase = fake()
    useCase.save.mockRejectedValueOnce(new TypeError('network'))
    const result = open(useCase)
    await act(async () => { await result.current.add(TARGET, ['c1']) })
    expect(result.current.outcome).toEqual({ status: 'failed', target: TARGET, message: 'network' })
    let ok = false
    await act(async () => { ok = await result.current.retry() })
    expect(ok).toBe(true)
    expect(useCase.read).toHaveBeenCalledTimes(2)
    // 저장소는 결과를 모르는 요청 뒤에 같은 입력만 받는다. 새 카드 id까지 같아야 한다.
    expect(useCase.save.mock.calls[1][0]).toBe(useCase.save.mock.calls[0][0])
    expect(result.current.outcome).toEqual({ status: 'done', target: TARGET, count: 1 })
  })

  it('앞선 요청이 실제로는 반영됐으면 다시 저장하지 않고 성공으로 알린다', async () => {
    const useCase = fake()
    useCase.save.mockRejectedValueOnce(new TypeError('network'))
    const result = open(useCase)
    await act(async () => { await result.current.add(TARGET, ['c1']) })
    const sent = useCase.save.mock.calls[0][0]
    useCase.read.mockResolvedValue({ ...sent, version: 5 })
    await act(async () => { await result.current.retry() })
    expect(useCase.save).toHaveBeenCalledTimes(1)
    expect(result.current.outcome).toEqual({ status: 'done', target: TARGET, count: 1 })
  })

  it('실패한 뒤 다른 설정을 고르면 앞선 입력을 다시 보내지 않고 새로 고른 설정만 붙인다', async () => {
    const useCase = fake()
    useCase.save.mockRejectedValueOnce(new TypeError('network'))
    const result = open(useCase)
    await act(async () => { await result.current.add(TARGET, ['c1']) })
    await act(async () => { await result.current.add(TARGET, ['c2']) })
    expect(useCase.save.mock.calls[1][0].settings.map((s) => s.item.title)).toEqual(['기존 설정', '별빛 탑'])
  })

  it('그 사이 대상의 초안이 바뀌었으면 최신 초안에 새로 붙인다', async () => {
    const useCase = fake()
    useCase.save.mockRejectedValueOnce(new Error('저장되지 않았습니다. 최신 상태를 다시 조회하세요.'))
    const result = open(useCase)
    await act(async () => { await result.current.add(TARGET, ['c1']) })
    useCase.read.mockResolvedValue({ ...mine([setting('기존 설정'), setting('다른 탭에서 더한 설정')]), version: 5 })
    await act(async () => { await result.current.retry() })
    const [again] = useCase.save.mock.calls[1]
    expect(again.version).toBe(5)
    expect(again.settings.map((s) => s.item.title)).toEqual(['기존 설정', '다른 탭에서 더한 설정', '리안'])
    expect(result.current.outcome).toEqual({ status: 'done', target: TARGET, count: 1 })
  })
})

describe('가져오기 저장 요청 (HTTP)', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
      ? Response.json({ csrfToken: 'studio-csrf' })
      : Response.json({ accessToken: 'studio-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'writer', operator: false } })))
    await login('writer@example.invalid', 'test-password')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('초안 저장 본문에 새 카드가 비공개와 출처(importedFrom)와 함께 들어가고 기존 카드는 그대로 남는다', async () => {
    const worldId = crypto.randomUUID()
    const kept = { ...setting('기존 설정'), item: { ...setting('기존 설정').item, id: crypto.randomUUID() } }
    const cardOf = (row: StudioSetting) => ({ id: row.item.id, title: row.item.title, body: row.item.text, cardType: 'character', areaCode: row.item.category, classification: row.userCategory, aliases: [], tags: row.tags, semanticMetadata: { studio: row }, visibility: 'private', lifecycle: 'active' })
    const draft = { worldId, draftRevision: 4, currentRevisionId: null, baseWorldRevisionId: null, name: '내 세계', description: '', cards: [cardOf(kept)], relationships: [], relationshipVersion: 1, relationshipStatus: 'current' }
    // 서버 대역: 읽기는 초안을, 저장은 보낸 카드를 그대로 담아 버전을 올린 초안을 돌려준다(호출마다 새 Response).
    const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Response.json(draft)
      const body = JSON.parse(String(init.body))
      return Response.json({ ...draft, draftRevision: 5, cards: body.cards, relationships: body.relationships })
    })
    const result = open(new WorldStudioUseCase(new HttpWorldStudioRepository(fetcher as typeof fetch)))
    await act(async () => { await result.current.add({ id: worldId, name: '내 세계' }, ['c2']) })
    expect(result.current.outcome).toMatchObject({ status: 'done', count: 1 })
    const [url, init] = fetcher.mock.calls[1]
    expect([url, init?.method]).toEqual([`/api/v1/world-studios/${worldId}/draft`, 'PUT'])
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ expectedDraftRevision: 4, replace: true })
    expect(body.cards[0].id).toBe(kept.item.id)
    const added = body.cards[1]
    expect(added).toMatchObject({ title: '별빛 탑', body: '봉인을 지키는 탑', cardType: 'location', visibility: 'private', lifecycle: 'active' })
    expect(added.semanticMetadata.importedFrom).toEqual({ worldId: 'src', worldName: '별빛 세계', authorNickname: '윤서하', revisionNo: 3, cardId: 'c2' })
    expect(added.semanticMetadata).not.toHaveProperty('revealFromEpisode')
    expect(body.relationships).toEqual([])
  })
})
