import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { HttpWorldStudioRepository } from './HttpWorldStudioRepository'

// Fork 세계관 독립(#583)이 서버에서 만든 세계관: 카드 메타데이터는 최상위 revealFromEpisode·importedFrom뿐(studio 없음)이고 관계 메타데이터는 {}다.
// 정본 필드가 항상 이기고 studio는 보조값이라 없어도 읽혀야 /worldstudio/{id}가 열린다.
const worldId = crypto.randomUUID(), kael = crypto.randomUUID(), gate = crypto.randomUUID(), bond = crypto.randomUUID(), picture = crypto.randomUUID()
const source = { worldId: crypto.randomUUID(), worldName: '원작 세계관', authorNickname: '원작자', revisionNo: 3, cardId: crypto.randomUUID() }
const card = (id: string, title: string, cardType: string, semanticMetadata: object) => ({
  id, title, body: title + ' 본문', cardType, areaCode: 'basic', classification: '', aliases: [], tags: [], semanticMetadata, visibility: 'public', lifecycle: 'active',
})
const relation = (over: object = {}) => ({
  id: bond, sourceCardId: kael, targetCardId: gate, category: 'structural', label: '수호', body: '', direction: 'directed', polarity: 'asserted', semanticMetadata: {}, lifecycle: 'active', ...over,
})
const detached = (version = 1, over: object = {}) => ({
  worldId, draftRevision: version, currentRevisionId: null, baseWorldRevisionId: null, name: '내 포크 세계관', description: '',
  cards: [
    card(kael, '카엘', 'character', { revealFromEpisode: 2, importedFrom: source }),
    card(gate, '성문', 'location', { revealFromEpisode: 1, importedFrom: { ...source, cardId: crypto.randomUUID() } }),
  ],
  relationships: [relation()],
  relationshipVersion: 1, relationshipStatus: 'current', relationshipEpisodes: { [bond]: 1 },
  ...over,
})
const read = (data: object) => new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json(data))).read(worldId)

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'studio-csrf' })
    : Response.json({ accessToken: 'studio-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: 'writer', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

it('studio 없는 카드 메타데이터와 {} 관계 메타데이터를 정본 필드와 최상위 키로 읽는다', async () => {
  const loaded = await read(detached())
  const [kaelRow, gateRow, bondRow] = loaded.settings
  expect(kaelRow).toMatchObject({
    visibility: 'public', revealFromEpisode: 2, importedFrom: source,
    item: { id: kael, title: '카엘', text: '카엘 본문', category: 'basic', kind: 'entity', entityType: 'character' },
  })
  expect(gateRow).toMatchObject({ visibility: 'public', revealFromEpisode: 1, item: { id: gate, kind: 'entity', entityType: 'location' } })
  expect(bondRow).toMatchObject({
    item: { id: bond, kind: 'relation', title: '수호', text: '', subjectId: kael, targetId: gate, polarity: 'asserted', predicate: 'custom_relation_directed', fromEpisode: 1, recordedFrom: 1 },
  })
})

it('인물 문서와 대표 이미지도 최상위 키에서 읽고, 모르는 키와 모양이 틀린 값은 읽을 때 버린다', async () => {
  const data = detached()
  data.cards[0].semanticMetadata = { revealFromEpisode: 2, characterDocs: { soul: '말투', episodes: {} }, imageId: picture, unknown: '비밀', importedFrom: { worldId: 3 } }
  const [kaelRow] = (await read(data)).settings
  expect(kaelRow).toMatchObject({ characterDocs: { soul: '말투' }, imageId: picture, revealFromEpisode: 2 })
  expect(kaelRow.importedFrom).toBeUndefined() // 모양이 틀린 출처는 읽지 않는다
  expect(kaelRow.serverMetadata).toBeUndefined() // 모르는 키는 저장 때 되돌려 보내지 않는다
})

it.each([
  ['structural', 'directed', 'custom_relation_directed'],
  ['structural', 'symmetric', 'custom_relation'],
  ['emotional', 'directed', 'custom_emotion'],
  ['emotional', 'symmetric', 'preserved_emotion_symmetric'],
  ['identity', 'directed', 'identity_of'],
])('{} 관계 메타데이터의 %s·%s 관계는 정본 필드로 관계 종류(%s)를 정한다', async (category, direction, predicate) => {
  const loaded = await read(detached(1, { relationships: [relation({ category, direction })] }))
  expect(loaded.settings[2].item).toMatchObject({ kind: 'relation', predicate, subjectId: kael, targetId: gate })
})

it('관계의 극성이 부정이면 부정으로, 없으면(null) 긍정으로 읽는다', async () => {
  const denied = await read(detached(1, { relationships: [relation({ polarity: 'denied' })] }))
  expect(denied.settings[2].item.polarity).toBe('denied')
  const unknown = await read(detached(1, { relationships: [relation({ polarity: null })] }))
  expect(unknown.settings[2].item.polarity).toBe('asserted')
})

it('읽은 세계관을 고쳐 저장해도 저장 모양은 그대로다: 카드는 studio와 최상위 키, 관계는 studio를 달고 모르는 키는 보내지 않는다', async () => {
  const data = detached()
  data.cards[0].semanticMetadata = { revealFromEpisode: 2, importedFrom: source, unknown: '비밀' } as typeof data.cards[0]['semanticMetadata']
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(data)).mockResolvedValueOnce(Response.json({ ...data, draftRevision: 2 }))
  const repo = new HttpWorldStudioRepository(fetcher), loaded = await repo.read(worldId)
  const edited = loaded.settings.map((s) => ({ ...s, item: { ...s.item, text: s.item.text + ' 수정' } }))
  await repo.saveStudio({ ...loaded, settings: edited })
  const body = JSON.parse(fetcher.mock.calls[1][1].body)
  const sent = body.cards.find((c: { id: string }) => c.id === kael)
  expect(Object.keys(sent.semanticMetadata).sort()).toEqual(['importedFrom', 'revealFromEpisode', 'studio'])
  expect(sent.semanticMetadata.studio.item.id).toBe(kael)
  expect(sent.visibility).toBe('public')
  expect(body.relationships[0]).toMatchObject({ id: bond, category: 'structural', direction: 'directed', polarity: 'asserted', label: '수호', body: ' 수정' })
  expect(body.relationships[0].semanticMetadata.studio.item.id).toBe(bond)
  expect(body.relationshipEpisodes).toEqual({ [bond]: 1 })
})
