import { describe, expect, it } from 'vitest'
import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryAdminRepository, InMemoryChatRepository, InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryReadingRecordRepository, InMemoryReadingRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../data/mock/InMemoryRepositories'
import { StudioUseCase } from '../usecases/StudioUseCase'
import { FeedbackUseCase } from '../usecases/FeedbackUseCase'
import { InboxUseCase } from '../usecases/InboxUseCase'
import { AdminUseCase } from '../usecases/AdminUseCase'
import { LibraryUseCase } from '../usecases/LibraryUseCase'

function setup() {
  const db=createFixtureDb()
  const w=db.works.find(w=>w.id==='starlight')!
  w.canonical=true
  const works=new InMemoryWorkRepository(db), feedback=new InMemoryFeedbackRepository(db), admin=new InMemoryAdminRepository(db), credits=new InMemoryCreditRepository(db), worlds=new InMemoryWorldRepository(db)
  return {db,w,works,feedback,admin,credits,worlds}
}

describe('canonical works never enter legacy aggregate mutations',()=>{
  it('blocks legacy studio entry and extraction before draft, world or credit mutation',async()=>{
    const {db,works,feedback,credits,worlds}=setup()
    const before=structuredClone(db)
    const studio=new StudioUseCase(works,credits,feedback,worlds)
    await expect(studio.open('starlight',undefined,'user')).rejects.toThrow('정본 집필실')
    await expect(studio.extractWorld('starlight',1,()=>true)).rejects.toThrow('정본 집필실')
    expect(db).toEqual(before)
  })
  it('does not invent persisted comments, feedback or operational reports',async()=>{
    const {db,w,works,feedback,admin}=setup()
    const uc=new FeedbackUseCase(works,feedback,admin)
    expect((await uc.getComments(w,1)).comments).toEqual([])
    await expect(uc.toggleCommentLike(w.id,w.id+'1c0')).rejects.toThrow('아직 연결되지')
    expect(db.cmLiked).toEqual({})
    await expect(uc.addComment(w.id,1,'독자','내용',null)).rejects.toThrow('아직 연결되지')
    await expect(uc.sendFeedback({workId:w.id,n:1,sentence:{t:'문장',pi:0},type:'질문',text:'질문',verified:false,nick:'독자'})).rejects.toThrow('아직 연결되지')
    await expect(uc.reportWork({workId:w.id,type:'기타',text:'신고',nick:'독자'})).rejects.toThrow('아직 연결되지')
    expect(db.comments).toEqual({})
    expect(db.reports).toEqual([])
    expect(db.reviewQueue).toEqual([])
  })
  it('blocks inbox actions before any demo status or audit changes',async()=>{
    const {db,w,works,feedback,admin,credits}=setup()
    db.inbox.push({id:'i',rid:'r',w:w.id,n:1,pi:0,type:'질문',who:'독자',text:'질문',baseText:'',status:'작가 검토 대기',ai:{cls:'질문',why:'',ev:''}})
    db.reviewQueue.push({id:'q',w:w.id,n:null,type:'신고',text:'내용',quote:'',status:'접수',who:'독자'})
    const before=structuredClone(db)
    expect(await new InboxUseCase(works,feedback).act('i','reject')).toContain('아직 연결되지')
    const uc=new AdminUseCase(admin,works,feedback,credits,new InMemoryChatRepository(db))
    expect(db).toEqual(before)
    expect((await uc.load()).isolation.some(x=>x.title===w.title)).toBe(false)
  })
  it('keeps canonical works out of the separate demo writing and appeal controls',async()=>{
    const {db,w,works,feedback,worlds}=setup()
    db.reviewQueue.push({id:'q',w:w.id,n:null,type:'신고',text:'내용',quote:'',status:'비공개 조치',who:'독자'})
    const uc=new LibraryUseCase(works,worlds,new InMemoryReadingRepository(db),feedback,new InMemoryReadingRecordRepository(db))
    const result=await uc.getWrite()
    expect(result.mine.some(row=>row.work.canonical)).toBe(false)
    expect(result.appeals).toEqual([])
  })
  it('does not claim to submit a canonical operational appeal',async()=>{
    const {db,w,works,feedback,worlds}=setup()
    db.reviewQueue.push({id:'q',w:w.id,n:null,type:'신고',text:'내용',quote:'',status:'비공개 조치',who:'독자'})
    const before=structuredClone(db)
    const uc=new LibraryUseCase(works,worlds,new InMemoryReadingRepository(db),feedback,new InMemoryReadingRecordRepository(db))
    expect(await uc.appeal('q','권리 확인')).toContain('아직 연결되지')
    expect(db).toEqual(before)
  })
  it('does not mutate a linked demo world before rejecting a canonical aggregate write',async()=>{
    const {db,w,works,feedback,worlds}=setup()
    db.worlds.push({id:'mine',name:'세계',description:'',rules:['규칙'],public:false,history:[]})
    w.worldIds=['mine']
    const before=structuredClone(db)
    const uc=new LibraryUseCase(works,worlds,new InMemoryReadingRepository(db),feedback,new InMemoryReadingRecordRepository(db))
    await expect(uc.editWorld('mine',{name:'변경',description:'',rules:'새 규칙'},true)).rejects.toThrow('정본 집필실')
    expect(db).toEqual(before)
  })
})
