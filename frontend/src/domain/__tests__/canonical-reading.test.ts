import { describe, expect, it } from 'vitest'
import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryReadingRecordRepository, InMemoryReadingRepository, InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { ReadingUseCase } from '../usecases/ReadingUseCase'
import { isMine } from '../entities/work'
import { ForkUseCase } from '../usecases/ForkUseCase'

describe('canonical reading, independent of sample slugs', () => {
  it('selects home shelves from returned works, not a hardcoded sample ID list', async () => {
    const db = createFixtureDb()
    const ids = new Map(db.works.map((w, i) => [w.id, `canonical-${i}`]))
    db.works = db.works.map(w => ({ ...w, id: ids.get(w.id)!, parent: w.parent ? ids.get(w.parent) : undefined }))
    const result = await new ReadingUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryReadingRecordRepository(db)).getHome(null, '추천')
    expect(result.picks).toHaveLength(6)
    expect(result.weekly).toHaveLength(4)
    expect(result.picks.every(w => w.id.startsWith('canonical-'))).toBe(true)
  })
  it('never ranks canonical works by placeholder engagement or recency', async () => {
    const db=createFixtureDb()
    db.works=db.works.map(w=>({...w,canonical:true,statisticsSupported:false}))
    const uc=new ReadingUseCase(new InMemoryWorkRepository(db),new InMemoryReadingRepository(db),new InMemoryReadingRecordRepository(db))
    const expected=db.works.filter(w=>!w.private && (!w.parent || w.eps.length>0)).slice().sort((a,b)=>a.title.localeCompare(b.title,'ko')).map(w=>w.id)
    expect((await uc.findWorks({sort:'latest'})).map(w=>w.id)).toEqual(expected)
    expect((await uc.findWorks({sort:'view'})).map(w=>w.id)).toEqual(expected)
    const home=await uc.getHome(null,'추천')
    expect(home.top10.map(w=>w.id)).toEqual(expected.slice(0,10))
    expect(home.fresh.map(w=>w.id)).toEqual(expected.slice(0,5))
    const tagged=await uc.getTag('꿈')
    expect(tagged.list.map(({w})=>w.title)).toEqual(tagged.list.map(({w})=>w.title).sort((a,b)=>a.localeCompare(b,'ko')))
  })
  it('hydrates Fork carry counts at the selected allowed epoch using the received slug', async()=>{
    const db=createFixtureDb()
    const work=db.works.find(w=>w.id==='guunmong')!
    work.id='canonical-original'; work.slug='legacy-link'; work.canonical=true
    const repo=new InMemoryWorkRepository(db)
    const calls:number[]=[]
    repo.readWorld=async(w,n)=>{calls.push(n);return {...w,rules:[`epoch ${n}`]}}
    const form=await new ForkUseCase(repo).getForm('legacy-link',2)
    expect(form?.work.id).toBe('canonical-original')
    expect(form?.work.rules).toEqual(['epoch 2'])
    expect(calls).toEqual([2])
  })
  it('uses verified owner membership, never a display author nickname', () => {
    const work = createFixtureDb().works[0]
    expect(isMine({ ...work, author: '나', mine: false })).toBe(false)
    expect(isMine({ ...work, author: '작성자', owner: 'member-uuid', mine: true })).toBe(true)
  })
})
