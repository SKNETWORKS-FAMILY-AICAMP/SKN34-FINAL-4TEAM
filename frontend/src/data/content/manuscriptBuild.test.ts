import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import '../../test/testLocks'
import {login} from '../api/auth'
import {HttpManuscriptBuildRepository} from './HttpManuscriptBuildRepository'
const work=crypto.randomUUID(),world=crypto.randomUUID(),job=crypto.randomUUID(),token=crypto.randomUUID()
const status=(state='running')=>({id:job,workId:work,status:state,build:{jobId:job,worldId:world,status:state,completedEpisodes:1,totalEpisodes:4,executionToken:token,failureCode:null,receipts:[]}})
beforeEach(async()=>{
 const values=new Map<string,string>()
 vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)})
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.endsWith('/csrf')?{csrfToken:'qa-csrf'}:{accessToken:'qa-access',user:{id:'writer',email:'writer@example.test',nickname:'writer',operator:false}})))
 await login('writer@example.test','qa-password')
})
afterEach(()=>vi.unstubAllGlobals())
it('접수 응답 유실과 새 인스턴스에서도 같은 key와 세계관을 유지한다',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(Response.json(status()))
 await expect(new HttpManuscriptBuildRepository(fetcher).start(work,world)).rejects.toThrow()
 await new HttpManuscriptBuildRepository(fetcher).start(work,world)
 expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({worldId:world,consent:true})
})
it('상태 조회는 POST하지 않으며 완료 receipt 없는 성공은 거절한다',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:404})).mockResolvedValueOnce(Response.json(status('completed')))
 const repo=new HttpManuscriptBuildRepository(fetcher)
 expect(await repo.read(work)).toBeNull()
 await expect(repo.read(work)).rejects.toThrow()
 expect(fetcher.mock.calls.every((c)=>!c[1].method||c[1].method==='GET')).toBe(true)
})
it('실패 재개는 현재 token을 사용하며 진행 중인 작업을 중복 실행하지 않는다',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(status('failed'))).mockResolvedValueOnce(Response.json(status('failed'))).mockResolvedValueOnce(Response.json(status())).mockResolvedValueOnce(Response.json(status()))
 const repo=new HttpManuscriptBuildRepository(fetcher)
 await repo.start(work,world)
 await repo.resume(work)
 expect(JSON.parse(fetcher.mock.calls[2][1].body).resumeToken).toBe(token)
 await repo.resume(work)
 expect(fetcher.mock.calls.filter(c=>c[1].method==='POST')).toHaveLength(2)
})
it('다른 계정의 요청 기록을 재개에 사용하지 않는다',async()=>{
 const repo=new HttpManuscriptBuildRepository(vi.fn().mockResolvedValue(Response.json(status('failed'))))
 await repo.start(work,world)
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.endsWith('/csrf')?{csrfToken:'qa-csrf'}:{accessToken:'qa-other',user:{id:'other',email:'other@example.test',nickname:'other',operator:false}})))
 await login('other@example.test','qa-password')
 await expect(repo.resume(work)).rejects.toThrow('요청 기록')
})

it('unknown 적재 복구는 원래 key와 payload를 보내며 신규 실행 token을 만들지 않는다',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(status('unknown')))
 const repo=new HttpManuscriptBuildRepository(fetcher)
 await repo.start(work,world)
 await repo.resume(work)
 expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[2][1].body)
 expect(JSON.parse(fetcher.mock.calls[2][1].body)).not.toHaveProperty('resumeToken')
})

it('이전 실패의 새 접수 허용은 조회로만 표시하고 재개 버튼으로 새 작업을 접수하지 않는다',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(status('failed')))
   .mockImplementation(async()=>Response.json({id:job,workId:work,status:'failed',build:null,recovery:'new_request'}))
 const repo=new HttpManuscriptBuildRepository(fetcher)
 await repo.start(work,world)
 expect(await repo.read(work)).toBeNull()
 await expect(repo.resume(work)).rejects.toThrow('새 작업')
 expect(fetcher.mock.calls.filter(c=>c[1].method==='POST')).toHaveLength(1)
})
it('결과 미확인 이전 작업은 별도 검토로 표시한다',async()=>{
 const repo=new HttpManuscriptBuildRepository(async()=>Response.json({id:job,workId:work,status:'failed',build:null,recovery:'manual_review'}))
 await expect(repo.read(work)).rejects.toThrow('별도 검토')
})
it('스냅샷 없는 queued 작업은 자동 재개 없이 별도 검토를 표시한다',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({id:job,workId:work,status:'queued',build:null,recovery:'manual_review'}))
 await expect(new HttpManuscriptBuildRepository(fetcher).read(work)).rejects.toThrow('별도 검토')
 expect(fetcher.mock.calls.map(c=>c[1].method)).toEqual(['GET'])
})
