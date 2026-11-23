import { describe, expect, it, vi } from 'vitest'
import { HttpWorkRepository } from './HttpWorkRepository'
import { HttpEpisodeRepository, type ReadingWorkRecord } from './HttpEpisodeRepository'
import { ForkUseCase } from '../../domain/usecases/ForkUseCase'
import { epsOf, isMine } from '../../domain/entities/work'

const record = (extra: Partial<ReadingWorkRecord> = {}): ReadingWorkRecord => ({
  id: 'work-uuid', slug: 'old-slug', title: '원고', summary: '소개', visibility: 'public', authorName: '나', ownerId: 'other-member',
  revision: 2, theme: 'star', hook: '', hanja: null, hero: null, heroBg: null, genres: ['판타지'], hashtags: ['서약'], views: 0, likes: 4,
  allowFork: true, allowForkPublication: true, forkableEpisodes: [2], source: null, episodes: [
    { number: 1, version: 1, versionId: 'v1', title: '하나', body: '첫 문단\n\n둘째 문단', inherited: false },
    { number: 2, version: 1, versionId: 'v2', title: '둘', body: '셋째 문단', inherited: false },
  ], ...extra,
})
const setup = (rows = [record()], owned: ReadingWorkRecord[] = [], loggedIn = false) => {
  const api = { readingList: vi.fn(async (mine: boolean) => mine ? owned : rows),
    readingWorld: vi.fn(async () => ({ workId: 'work-uuid', episode: 1, documents: [] })),
    readingWorldCards: vi.fn(async () => ({ workId: 'work-uuid', worldId: null, upto: 0, cards: [], relationships: [], relationshipStatus: 'current' })),
    fork: vi.fn(async () => ({ id: 'created-server-uuid' })), writingList: vi.fn(async () => []),
  }
  return { api, repository: new HttpWorkRepository(api as unknown as HttpEpisodeRepository, () => loggedIn) }
}

describe('canonical WorkRepository', () => {
  it('uses server UUID, paragraphs and ownership; never author nickname or fabricated counters', async () => {
    const { repository } = setup()
    const [work] = await repository.listWorks()
    expect(work.id).toBe('work-uuid')
    expect(work.slug).toBe('old-slug')
    expect(work.eps[0].p).toEqual(['첫 문단', '둘째 문단'])
    expect(isMine(work)).toBe(false)
    // 좋아요 수는 서버 값이지만 댓글 수·갱신 시각은 서버에 없으니 지표 전체를 "지원"으로 표시하지 않는다.
    expect(work.likes).toBe(4)
    expect(work.statisticsSupported).toBe(false)
    expect(work.forkEps).toEqual([2])
    expect(work.wiki?.docs).toEqual([])
  })
  it('merges only verified owned API records and propagates failures without a fixture fallback', async () => {
    const { api, repository } = setup([record()], [record({ ownerId: 'verified-member' })], true)
    expect((await repository.listWorks()).filter(isMine)).toHaveLength(1)
    api.readingList.mockRejectedValueOnce(new Error('offline'))
    await expect(repository.listWorks()).rejects.toThrow('offline')
  })
  it('splits inherited prefix exactly once and preserves version IDs', async () => {
    const { repository } = setup([record({ source: { workId: 'parent-uuid', title: '부모', episode: 1, version: 1, direction: '분기' },
      episodes: record().episodes.map((e, i) => ({ ...e, inherited: i === 0 })) })])
    const [work] = await repository.listWorks()
    expect(work.snap?.eps).toHaveLength(1)
    expect(work.eps).toHaveLength(1)
    expect(epsOf(work)).toHaveLength(2)
    expect(epsOf(work)[0].versionId).toBe('v1')
  })
  it('requests an episode-scoped wiki and fails rather than saving unsupported aggregate writes', async () => {
    const { api, repository } = setup()
    const [work] = await repository.listWorks()
    await repository.readWorld(work, 1)
    expect(api.readingWorld).toHaveBeenCalledWith('work-uuid', 1)
    await expect(repository.saveWork(work)).rejects.toThrow('정본 집필실')
    await expect(repository.saveDraft('work-uuid', {} as never)).rejects.toThrow('정본 집필실')
    await expect(repository.deleteDraft('work-uuid')).rejects.toThrow('정본 집필실')
  })
  it('parses the real public transport and preserves scoped rich wiki fields without new history claims', async () => {
    const document = { id:'logical-char',versionId:'wiki-version',category:'char',name:'인물',body:'원문',aliases:['별칭'],tags:['태그'],
      properties:[{name:'설명',value:'공개 설명'},{name:'상태',value:'공개 상태'}],color:'#123456',image:null,episode:null,line:null,
      participants:[],knowledge:[{text:'공개 지식',knownAt:1,publicAt:2}],links:[{to:'logical-world',kind:'소속'}] }
    const world = { workId:'work-uuid',episode:2,documents:[document] }
    const fetcher=vi.fn(async (path:RequestInfo | URL) => Response.json(String(path).includes('/world?') ? world : [record()]))
    const repository=new HttpWorkRepository(new HttpEpisodeRepository(fetcher),()=>false)
    const [work]=await repository.listWorks()
    const scoped=await repository.readWorld(work,2)
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/public/works/work-uuid/world?episode=2',expect.objectContaining({method:'GET'}))
    expect(scoped.cast).toEqual([{n:'인물',c:'#123456',d:'공개 설명',st:'공개 상태',knowledge:document.knowledge}])
    expect(scoped.wiki?.docs[0]).toMatchObject({id:'logical-char',t:'인물',body:'원문',alias:['별칭'],props:{설명:'공개 설명',상태:'공개 상태'},knowledge:document.knowledge,links:[{to:'logical-world',k:'소속'}]})
    await expect(repository.readWorld(work,1)).rejects.toThrow('기준 회차')
    world.workId='another-work'
    await expect(repository.readWorld(work,2)).rejects.toThrow('작품')
  })
  it('keeps the source title and deleted flag from the transport so a deleted original is shown as deleted', async () => {
    const forked = record({ source: { workId: 'parent-uuid', title: '부모', episode: 1, version: 1, direction: '분기', deleted: true },
      episodes: record().episodes.map((e, i) => ({ ...e, inherited: i === 0, body: i === 0 ? '' : e.body })) })
    const repository = new HttpWorkRepository(new HttpEpisodeRepository(vi.fn(async () => Response.json([forked]))), () => false)
    const [work] = await repository.listWorks()
    expect(work.parentTitle).toBe('부모')
    expect(work.parentDeleted).toBe(true)
  })
  it('rejects malformed canonical transport instead of silently dropping required ownership metadata', async () => {
    const fetcher=vi.fn(async () => Response.json([record({ownerId:''})]))
    const repository=new HttpWorkRepository(new HttpEpisodeRepository(fetcher),()=>false)
    await expect(repository.listWorks()).rejects.toThrow('서버 응답 형식')
  })
  it('returns only the server-created Fork identity, not a local generated work', async () => {
    const { api, repository } = setup()
    expect(await repository.createFork('work-uuid', 2, '분기 제목', '분기 방향')).toEqual({ id: 'created-server-uuid' })
    expect(api.fork).toHaveBeenCalledWith('work-uuid', 2, '분기 제목', '분기 방향')
  })
  it('포크 생성의 중복 거절은 삭제한 포크 때문인 안내로 바꾸고 다른 거절은 서버 문구 그대로 둔다 (#605)', async () => {
    const { api, repository } = setup()
    api.fork.mockRejectedValueOnce(new Error('이미 만든 분기 작품이 있어요.'))
    await expect(repository.createFork('work-uuid', 2, '분기 제목', '분기 방향')).rejects.toThrow('이 원작에서 만든 포크를 삭제한 적이 있어 다시 만들 수 없어요.')
    api.fork.mockRejectedValueOnce(new Error('이 회차에서는 분기할 수 없어요.'))
    await expect(repository.createFork('work-uuid', 2, '분기 제목', '분기 방향')).rejects.toThrow('이 회차에서는 분기할 수 없어요.')
  })
})


it('공개 중단된 중간 회차의 자리를 보존하고 뒤 회차 번호를 바꾸지 않는다', async () => {
  const {repository}=setup([record({episodes:[{number:3,version:1,versionId:'v3',title:'3화',body:'공개 본문',inherited:false}]})])
  const [work]=await repository.listWorks()
  expect(epsOf(work)).toHaveLength(3)
  expect(epsOf(work)[0]).toMatchObject({hidden:true,p:[]})
  expect(epsOf(work)[1]).toMatchObject({hidden:true,p:[]})
  expect(epsOf(work)[2].t).toBe('3화')
})


it('공개 중단된 회차는 공개 세계관 조회를 요청하지 않는다',async()=>{
  const {repository,api}=setup([record({episodes:[{number:2,version:1,versionId:'v2',title:'2화',body:'본문',inherited:false}]})])
  const [work]=await repository.listWorks()
  await repository.readWorld(work,1)
  expect(api.readingWorld).not.toHaveBeenCalled()
})


it('preserves published author notes through HTTP and inherited Fork reading', async () => {
  const row = record({ source: {workId:'parent',title:'원작',episode:1,version:1,direction:'',deleted:true},
    episodes: [{...record().episodes[0], inherited:true, authorNote:'원작 후기'}] })
  const api = new HttpEpisodeRepository(vi.fn(async () => Response.json([row])))
  const repository = new HttpWorkRepository(api, () => false)
  const [work] = await repository.listWorks()
  expect(work.parentDeleted).toBe(true)
  expect(epsOf(work)[0].authorNote).toBe('원작 후기')
})

it('uses the server allowlist and reports the actual preview basis when the selected episode is no longer allowed', async () => {
  const { api, repository } = setup([record({
    forkableEpisodes: [3],
    episodes: [{ number: 3, version: 1, versionId: 'v3', title: '3화', body: '본문', inherited: false }],
  })])
  api.readingWorld.mockResolvedValue({ workId: 'work-uuid', episode: 3, documents: [] })
  const form = await new ForkUseCase(repository).getForm('work-uuid', 1)
  expect(form?.forkList).toEqual([3])
  expect(form?.basisEpisode).toBe(3)
  expect(api.readingWorld).toHaveBeenCalledWith('work-uuid', 3)
})

it('포크 미리보기: 연결된 세계관이면 기준 회차의 독자 설정 위키 카드를 읽고 레거시 공개 설정집은 요청하지 않는다 (#559)', async () => {
  const card = (id: string, title: string, cardType: string, revealFromEpisode: number) => ({ id, title, text: title, cardType, aliases: [], tags: [], revealFromEpisode, imageId: null })
  const served = { workId: 'work-uuid', worldId: crypto.randomUUID(), upto: 2, cards: [card('c1', '리안', 'character', 1), card('c2', '봉인', 'rule', 2)], relationships: [], relationshipStatus: 'current' }
  const fetcher = vi.fn(async (path: RequestInfo | URL) => Response.json(String(path).includes('/world-cards') ? served : [record()]))
  const form = await new ForkUseCase(new HttpWorkRepository(new HttpEpisodeRepository(fetcher), () => false)).getForm('work-uuid', 2)
  const urls = fetcher.mock.calls.map(([path]) => String(path))
  expect(urls).toContain('/api/v1/public/works/work-uuid/world-cards?upto=2')
  expect(urls.some((url) => url.includes('/world?'))).toBe(false)
  expect(form?.work.rules).toEqual(['봉인'])
  expect(form?.work.cast.map((c) => c.n)).toEqual(['리안'])
})

describe('연결된 세계관의 독자 공개 카드 (DEC-46)', () => {
  const [worldId, rian, tower, link, towerImage] = Array.from({ length: 5 }, () => crypto.randomUUID())
  const cards = [
    { id: rian, title: '리안', text: '## 성격\n끈질기다', cardType: 'character', aliases: ['견습 서약사'], tags: ['주인공'], revealFromEpisode: 1, imageId: null },
    { id: tower, title: '별빛 탑', text: '봉인을 지키는 탑.', cardType: 'location', aliases: [], tags: [], revealFromEpisode: 2, imageId: towerImage },
  ]
  const served = (extra: object = {}) => ({ workId: 'work-uuid', worldId, upto: 2, cards, relationships: [{ id: link, sourceCardId: rian, targetCardId: tower, label: '머무는 곳' }], relationshipStatus: 'current', ...extra })
  /** 호출마다 새 Response를 준다(같은 Response는 한 번만 읽힌다). */
  const repositoryOf = (body: unknown, status = 200) => {
    const fetcher = vi.fn(async () => Response.json(body, { status }))
    return { fetcher, repository: new HttpWorkRepository(new HttpEpisodeRepository(fetcher), () => false) }
  }

  it('기준 회차를 붙여 Bearer 없이 읽고 서버가 준 카드·관계를 그대로 돌려준다', async () => {
    const { fetcher, repository } = repositoryOf(served())
    expect(await repository.readWorldCards('work-uuid', 2)).toEqual(served())
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/public/works/work-uuid/world-cards?upto=2')
    expect(init.method).toBe('GET')
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('관계 방향·본문·극성을 읽고 이전 응답과 null도 보존하며 잘못된 값은 거절한다', async () => {
    const relationship = { id: link, sourceCardId: rian, targetCardId: tower, label: '관계', category: 'emotional', direction: 'directed', body: '원문\n근거', polarity: 'denied' }
    expect((await repositoryOf(served({ relationships: [relationship] })).repository.readWorldCards('work-uuid')).relationships[0]).toEqual(relationship)
    const nullable = { ...relationship, category: null, direction: null, body: null, polarity: null }
    expect((await repositoryOf(served({ relationships: [nullable] })).repository.readWorldCards('work-uuid')).relationships[0]).toEqual(nullable)
    expect((await repositoryOf(served()).repository.readWorldCards('work-uuid')).relationships[0]).not.toHaveProperty('direction')
    // 「동일 인물」(다른 이름 → 본체)도 분류 그대로 읽는다.
    expect((await repositoryOf(served({ relationships: [{ ...relationship, category: 'identity' }] })).repository.readWorldCards('work-uuid')).relationships[0].category).toBe('identity')
    for (const invalid of [{ ...relationship, category: 'other' }, { ...relationship, direction: 'other' }, { ...relationship, body: 3 }, { ...relationship, polarity: 'other' }]) {
      await expect(repositoryOf(served({ relationships: [invalid] })).repository.readWorldCards('work-uuid')).rejects.toThrow('서버 응답 형식')
    }
  })

  it('관계 이력(history)을 읽고 이력이 없던 응답은 그대로 두며 모양이 어긋난 이력은 거절한다', async () => {
    const history = [{ episode: 1, label: '경계', body: '' }, { episode: 3, label: '보호', body: '지킨다' }]
    const relationship = { id: link, sourceCardId: rian, targetCardId: tower, label: '보호', history }
    expect((await repositoryOf(served({ relationships: [relationship] })).repository.readWorldCards('work-uuid')).relationships[0]).toEqual(relationship)
    expect((await repositoryOf(served({ relationships: [{ ...relationship, history: [] }] })).repository.readWorldCards('work-uuid')).relationships[0].history).toEqual([])
    expect((await repositoryOf(served()).repository.readWorldCards('work-uuid')).relationships[0]).not.toHaveProperty('history')
    for (const invalid of [[{ episode: 0, label: '경계', body: '' }], [{ episode: 1.5, label: '경계', body: '' }], [{ episode: 1, label: 3, body: '' }], [{ episode: 1, label: '경계' }], 'x']) {
      await expect(repositoryOf(served({ relationships: [{ ...relationship, history: invalid }] })).repository.readWorldCards('work-uuid')).rejects.toThrow('서버 응답 형식')
    }
  })


  it('카드의 imageId는 서버가 준 대로(없으면 null) 읽고, 문자열이 아니면 빈 위키로 바꾸지 않고 실패한다', async () => {
    const [first, second] = cards
    const { imageId: _kept, ...withoutField } = second // 필드가 없던 옛 응답
    expect((await repositoryOf(served({ cards: [first, withoutField] })).repository.readWorldCards('work-uuid')).cards.map((card) => card.imageId)).toEqual([null, null])
    expect((await repositoryOf(served()).repository.readWorldCards('work-uuid')).cards.map((card) => card.imageId)).toEqual([null, towerImage])
    await expect(repositoryOf(served({ cards: [{ ...first, imageId: 3 }] })).repository.readWorldCards('work-uuid')).rejects.toThrow('서버 응답 형식')
  })

  it('기준 회차가 없으면 upto 없이 읽고 관계 상태가 없는 응답은 current로 읽는다', async () => {
    const { fetcher, repository } = repositoryOf(served({ relationshipStatus: undefined }))
    expect((await repository.readWorldCards('work-uuid')).relationshipStatus).toBe('current')
    expect(fetcher.mock.calls[0]).toEqual(['/api/v1/public/works/work-uuid/world-cards', expect.anything()])
  })

  it('연결된 세계관이 없는 작품과 관계를 읽지 못한 응답을 서버가 준 그대로 구분해 돌려준다', async () => {
    const unlinked = { workId: 'work-uuid', worldId: null, upto: 0, cards: [], relationships: [], relationshipStatus: 'current' }
    expect(await repositoryOf(unlinked).repository.readWorldCards('work-uuid')).toEqual(unlinked)
    const unavailable = served({ relationships: [], relationshipStatus: 'unavailable' })
    expect((await repositoryOf(unavailable).repository.readWorldCards('work-uuid')).relationshipStatus).toBe('unavailable')
  })

  it('다른 작품의 응답·모르는 카드 유형·없는 작품(404)은 빈 위키로 바꾸지 않고 실패한다', async () => {
    await expect(repositoryOf(served({ workId: 'another-work' })).repository.readWorldCards('work-uuid')).rejects.toThrow('작품')
    await expect(repositoryOf(served({ cards: [{ ...cards[0], cardType: 'weapon' }] })).repository.readWorldCards('work-uuid')).rejects.toThrow('서버 응답 형식')
    await expect(repositoryOf({ detail: '작품을 찾을 수 없어요.' }, 404).repository.readWorldCards('work-uuid')).rejects.toThrow('작품을 찾을 수 없어요.')
  })
})
