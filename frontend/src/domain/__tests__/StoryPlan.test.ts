import { describe, expect, it, vi } from 'vitest'
import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { InMemoryStoryPlanRepository } from '../../data/plans/InMemoryStoryPlanRepository'
import { StoryPlanUseCase } from '../usecases/StoryPlanUseCase'

const plot = { kind: 'plot' as const, parentId: null, title: '새로운 선택', content: '계획', episodeNumber: null, characterIds: [], placeIds: [] }
function setup() {
  const db = createFixtureDb()
  const work = db.works.find(w => w.id === 'starlight')!
  work.owner = 'me'
  const repo = new InMemoryStoryPlanRepository(new InMemoryWorkRepository(db))
  return { db, work, repo, api: new StoryPlanUseCase(repo) }
}

describe('11 플롯·장면 계획', () => {
  it('플롯과 참조한 장면을 생성·목록·상세 조회하고 수정·삭제한다', async () => {
    const { api, work } = setup()
    const original = structuredClone(work)
    const refs = await api.references(work.id)
    const p = await api.save(work.id, plot)
    const scene = { ...plot, kind: 'scene' as const, parentId: p.id, title: '탑으로 돌아가다', episodeNumber: refs.episodes[0].number, characterIds: [refs.characters[0].id], placeIds: [refs.places[0].id] }
    const s = await api.save(work.id, scene)
    expect(await api.list(work.id)).toHaveLength(2)
    expect(await api.read(work.id, s.id)).toMatchObject(scene)
    const changed = await api.save(work.id, { ...scene, title: '다른 장면' }, s)
    expect(changed.revision).toBe(s.revision + 1)
    await expect(api.remove(work.id, p)).rejects.toThrow(/장면/)
    await api.remove(work.id, changed)
    await expect(api.read(work.id, s.id)).rejects.toThrow()
    const updated = await api.save(work.id, { ...plot, title: '바뀐 플롯' }, p)
    expect((await api.read(work.id, p.id)).title).toBe('바뀐 플롯')
    await api.remove(work.id, updated)
    expect(await api.list(work.id)).toEqual([])
    expect(work).toEqual(original)
  })

  it('오래된 수정·삭제는 거부하고 기존 내용을 보존한다', async () => {
    const { api, work } = setup()
    const p = await api.save(work.id, plot)
    await api.save(work.id, { ...plot, title: '최신 계획' }, p)
    await expect(api.save(work.id, plot, p)).rejects.toThrow(/변경/)
    await expect(api.remove(work.id, p)).rejects.toThrow(/변경/)
    expect((await api.read(work.id, p.id)).title).toBe('최신 계획')
  })

  it('삭제 충돌 후 최신 대상을 검토만 하고 재확인한 revision으로 삭제한다', async () => {
    const { api, work, repo } = setup()
    const p = await api.save(work.id, plot)
    const fresh = await api.save(work.id, { ...plot, title: '다른 탭에서 수정', content: '삭제 전 확인할 최신 내용' }, p)
    await expect(api.remove(work.id, p)).rejects.toThrow(/변경/)
    const remove = vi.spyOn(repo, 'remove')
    const reviewed = await api.reviewDeletion(work.id, p.id)
    expect(reviewed).toEqual({ plans: [fresh], target: fresh })
    expect(remove).not.toHaveBeenCalled()
    expect(await api.read(work.id, p.id)).toEqual(fresh)
    await api.remove(work.id, reviewed.target!)
    expect(remove).toHaveBeenCalledWith(work.id, fresh, undefined)
    expect(await api.list(work.id)).toEqual([])
  })

  it('다른 탭에서 삭제한 대상은 목록에서 제외하고 다시 삭제하지 않는다', async () => {
    const { api, work, repo } = setup()
    const p = await api.save(work.id, plot)
    await api.remove(work.id, p)
    const remove = vi.spyOn(repo, 'remove')
    expect(await api.reviewDeletion(work.id, p.id)).toEqual({ plans: [], target: null })
    expect(remove).not.toHaveBeenCalled()
  })

  it('삭제 검토의 조회 실패와 권한 거부를 대상 삭제로 바꾸지 않는다', async () => {
    const { api, work, repo } = setup()
    const p = await api.save(work.id, plot)
    const controller = new AbortController()
    const failure = new Error('목록 조회 실패')
    const list = vi.spyOn(repo, 'list').mockRejectedValueOnce(failure)
    await expect(api.reviewDeletion(work.id, p.id, controller.signal)).rejects.toBe(failure)
    expect(list).toHaveBeenCalledWith(work.id, controller.signal)
    work.owner = 'someone-else'; work.author = '다른 작가'
    await expect(api.reviewDeletion(work.id, p.id)).rejects.toThrow(/권한/)
  })

  it('다른 작품의 부모·인물·장소·회차와 잘못된 입력을 거부한다', async () => {
    const { api, work } = setup()
    for (const data of [
      { ...plot, title: '  ' },
      { ...plot, kind: 'scene' as const, parentId: 'foreign' },
      { ...plot, kind: 'scene' as const, parentId: null },
      { ...plot, characterIds: ['foreign'] },
      { ...plot, placeIds: ['foreign'] },
      { ...plot, episodeNumber: 999 },
    ]) await expect(api.save(work.id, data)).rejects.toThrow()
    expect(await api.list(work.id)).toEqual([])
  })

  it('타인 작품에 접근하거나 반환된 복사본으로 저장본을 바꿀 수 없다', async () => {
    const { api, work } = setup()
    const p = await api.save(work.id, plot)
    p.title = '외부 변경'
    expect((await api.read(work.id, p.id)).title).toBe(plot.title)
    work.owner = 'someone-else'; work.author = '다른 작가'
    await expect(api.list(work.id)).rejects.toThrow()
    await expect(api.references(work.id)).rejects.toThrow()
    await expect(api.remove(work.id, p)).rejects.toThrow()
  })

  it('유효한 플롯 아래에서도 외부 참조·중복 참조·잘못된 분류를 거부한다', async () => {
    const { api, work, db } = setup()
    const p = await api.save(work.id, plot)
    const refs = await api.references(work.id)
    const scene = { ...plot, kind: 'scene' as const, parentId: p.id }
    for (const value of [
      { ...scene, characterIds: ['foreign'] },
      { ...scene, characterIds: [refs.places[0].id] },
      { ...scene, placeIds: [refs.characters[0].id] },
      { ...scene, characterIds: [refs.characters[0].id, refs.characters[0].id] },
    ]) await expect(api.save(work.id, value)).rejects.toThrow()
    const other = db.works.find(w => w.id !== work.id)!
    other.owner = 'me'
    await expect(api.save(other.id, scene)).rejects.toThrow()
    expect(await api.list(work.id)).toHaveLength(1)
  })

  it('연결 회차가 사라져도 계획을 지우지 않고 연결 확인 필요 상태로 조회한다', async () => {
    const { api, work } = setup()
    const p = await api.save(work.id, plot)
    const scene = await api.save(work.id, { ...plot, kind: 'scene', parentId: p.id, episodeNumber: 1 })
    work.eps = []
    expect((await api.read(work.id, scene.id)).episodeMissing).toBe(true)
    expect((await api.list(work.id)).find(s => s.id === scene.id)?.episodeMissing).toBe(true)
    expect((await api.read(work.id, scene.id)).title).toBe(scene.title)
  })
})
