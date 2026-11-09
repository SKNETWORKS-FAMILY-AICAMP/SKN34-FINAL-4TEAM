import { describe, expect, it, vi } from 'vitest'
import { HttpWorkRepository } from './HttpWorkRepository'
import { HttpEpisodeRepository, type ReadingWorkRecord } from './HttpEpisodeRepository'
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
})
