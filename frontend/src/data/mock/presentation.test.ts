import { expect, it } from 'vitest'
import { forkList } from '../../domain/entities/work'
import { presentationDb, PresentationWorldRepository } from './presentation'

it('opens the same world and preserves the second episode fork snapshot', async () => {
  const db = presentationDb()
  const work = db.works.find(w => w.id === 'hong')!
  expect(forkList(work, db.worlds)).toEqual([2])
  expect(db.drafts.hong.no).toBe(3)
  expect(db.works.find(w => w.id === 'hong-lamp')?.snap?.eps).toEqual(work.eps)
  const repo = new PresentationWorldRepository()
  const world = await repo.read(work.worldIds![0])
  expect(world.settings.some(row => row.item.predicate === 'child_of')).toBe(true)
  const saved = await repo.saveStudio({...world, name:'리허설'})
  expect((await repo.read(world.id)).name).toBe('리허설')
  await expect(repo.saveStudio(world)).rejects.toThrow()
  expect(saved.version).toBe(world.version + 1)
})

it('provides linked management examples and keeps review candidates out of confirmed settings', async () => {
  const repo = new PresentationWorldRepository()
  const world = await repo.read('hong-world')
  const ids = new Set(world.settings.map(s => s.item.id))
  for (const {item} of world.settings) {
    for (const ref of [item.subjectId, item.targetId, item.afterId, ...item.relatedIds]) {
      if (ref) expect(ids.has(ref), ref).toBe(true)
    }
  }
  expect(world.settings.some(s => s.item.entityType === 'location')).toBe(true)
  expect(world.settings.some(s => s.item.afterId)).toBe(true)
  const candidate = world.analysis!.candidates[0]
  expect(ids.has(candidate.id)).toBe(false)
  const approved = await repo.approve(world, [candidate.id], [])
  expect(approved.settings.some(s => s.item.id === candidate.id)).toBe(true)
  expect(approved.analysis!.candidates[1].decision).toBe('pending')
})

it('preloads writing references, plot, storyboard and character conversations', () => {
  const db = presentationDb()
  const work = db.works.find(w => w.id === 'hong')!
  expect(work.memo).toContain('춘섬')
  expect(work.wiki?.docs.some(d => d.cat === 'place')).toBe(true)
  expect(work.wiki?.docs.find(d => d.t === '길동')?.body).toContain('홍문')
  expect(work.wiki?.docs.filter(d => d.cat === 'event').every(d => d.body.length > 0)).toBe(true)
  for (const person of work.cast) expect(db.chat['hong/' + person.n]?.length).toBeGreaterThan(1)
})

it('assigns the PPT portraits to every prepared character document', () => {
  const work = presentationDb().works.find(w => w.id === 'hong')!
  for (const person of work.cast) {
    expect(work.wiki!.docs.find(d => d.t === person.n)?.img).toMatch(/\.png/)
  }
})
