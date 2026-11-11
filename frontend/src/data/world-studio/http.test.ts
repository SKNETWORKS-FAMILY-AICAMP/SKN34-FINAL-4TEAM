import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import '../../test/testLocks'
import {login} from '../api/auth'
import {HttpWorldStudioRepository} from './HttpWorldStudioRepository'
import {newSetting,type StudioWorld} from '../../domain/entities/studioWorld'
import {readFileSync} from 'node:fs'

const id=crypto.randomUUID()
const a={...newSetting(),item:{...newSetting().item,id:crypto.randomUUID(),kind:'entity' as const,entityType:'character',title:'가',text:'원문\n보존'}}
const b={...a,item:{...a.item,id:crypto.randomUUID(),title:'나'}}
const relation={...newSetting(),item:{...newSetting().item,id:crypto.randomUUID(),kind:'relation' as const,title:'신뢰와 경계',text:'원문 관계',subjectId:a.item.id,targetId:b.item.id,predicate:'custom_emotion',polarity:'denied' as const}}
const wire=(version=2)=>({worldId:id,draftRevision:version,currentRevisionId:null,baseWorldRevisionId:null,name:'세계관',description:'설명',cards:[a,b].map(row=>({id:row.item.id,title:row.item.title,body:row.item.text,cardType:'character',areaCode:row.item.category,classification:row.userCategory,aliases:[],tags:row.tags,semanticMetadata:{studio:row},visibility:'private',lifecycle:'active'})),relationships:[{id:relation.item.id,sourceCardId:a.item.id,targetCardId:b.item.id,category:'emotional',body:relation.item.text,label:relation.item.title,direction:'directed',polarity:'denied',semanticMetadata:{studio:relation},lifecycle:'active'}],relationshipVersion:4,relationshipStatus:'current'})
beforeEach(async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/csrf')?Response.json({csrfToken:'studio-csrf'}):Response.json({accessToken:'studio-bearer',user:{id:'writer',email:'writer@example.invalid',nickname:'writer',operator:false}})))
 await login('writer@example.invalid','test-password')
})
afterEach(()=>vi.unstubAllGlobals())
it('reads legacy canonical cards without studio metadata and keeps their text',async()=>{
 const response=wire();response.cards[0].semanticMetadata={} as typeof response.cards[0]['semanticMetadata']
 const repo=new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json(response)))
 const loaded=await repo.read(id)
 expect(loaded.settings[0].item.text).toBe(a.item.text)
 expect(loaded.settings[0].item.entityType).toBe('character')
 expect(loaded.settings[0].item.decision).toBe('approved')
})
it('orders template cards by their preserved template order rather than UUID',async()=>{
 const response=wire();response.relationships=[]
 const cards=response.cards.map((c,i)=>({...c,semanticMetadata:{studio:{...c.semanticMetadata.studio,templateOrder:1-i}}}))
 const fetcher=vi.fn().mockImplementation(async(_path:string,init:RequestInit)=>Response.json({...response,cards,draftRevision:init.method==='GET'?2:3}))
 const repo=new HttpWorldStudioRepository(fetcher)
 const loaded=await repo.read(id)
 expect(loaded.settings.map(s=>s.item.id)).toEqual([b.item.id,a.item.id])
 await repo.saveStudio(loaded)
 const body=JSON.parse(fetcher.mock.calls[1][1].body)
 expect(body.cards.map((c:{semanticMetadata:{studio:{templateOrder:number}}})=>c.semanticMetadata.studio.templateOrder)).toEqual([0,1])
})
it('reads all real template resource cards through the HTTP contract',async()=>{
 const templates: {worldId:string;name:string;description:string;cards:{id:string;title:string;body:string;cardType:string}[]}[]=JSON.parse(readFileSync(new URL('../../../../backend/content-service/src/main/resources/genre-templates.json',import.meta.url),'utf8'))
 for(const t of templates){
  const response={...wire(),worldId:t.worldId,name:t.name,description:t.description,relationships:[],cards:t.cards.map(c=>({...c,areaCode:'basic',classification:'',aliases:[],tags:[],semanticMetadata:{},visibility:'private',lifecycle:'active'}))}
  const result=await new HttpWorldStudioRepository(vi.fn().mockImplementation(async()=>Response.json(response))).read(t.worldId)
  expect(result.settings.map(s=>s.item.text)).toEqual(t.cards.map(c=>c.body))
 }
})
it('rejects malformed studio metadata instead of silently replacing it',async()=>{
 const response=wire();response.cards[0].semanticMetadata={studio:{}} as typeof response.cards[0]['semanticMetadata']
 await expect(new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json(response))).read(id)).rejects.toThrow()
})
it('loads only an authenticated coherent current graph with lossless relation metadata',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json(wire()))
 const controller=new AbortController()
 const loaded=await new HttpWorldStudioRepository(fetcher).read(id,controller.signal)
 expect(loaded.settings).toEqual([a,b,relation])
 expect(fetcher).toHaveBeenCalledWith(`/api/v1/world-studios/${id}`,expect.objectContaining({credentials:'same-origin',headers:expect.objectContaining({Authorization:'Bearer studio-bearer'})}))
 controller.abort();expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
})
it('saves current cards and relations separately with CSRF and full replacement deletion',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json(wire(3)))
 const world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null}
 const saved=await new HttpWorldStudioRepository(fetcher).saveStudio(world)
 const [url,init]=fetcher.mock.calls[0],body=JSON.parse(init.body)
 expect(url).toBe(`/api/v1/world-studios/${id}/draft`)
 expect(init.headers).toEqual(expect.objectContaining({Authorization:'Bearer studio-bearer','X-CSRF-TOKEN':'studio-csrf'}))
 expect(body).toMatchObject({expectedDraftRevision:2,replace:true,cards:expect.any(Array),relationships:[expect.objectContaining({id:relation.item.id,body:'원문 관계',direction:'directed',polarity:'denied'})]})
 expect(body.cards).toHaveLength(2);expect(body.cards.some((c:{id:string})=>c.id===relation.item.id)).toBe(false)
 expect(saved.version).toBe(3)
})
it('retries the exact key and body after ambiguous failure and will not replace a pending input',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(Response.json(wire(3)))
 const repo=new HttpWorldStudioRepository(fetcher),world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null}
 await expect(repo.saveStudio(world)).rejects.toThrow()
 await expect(repo.saveStudio({...world,name:'different'})).rejects.toThrow('같은 입력')
 await repo.saveStudio(world)
 expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body)
})
it('allows corrected input after a definite validation rejection, but not after an ambiguous write',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({code:'WORLD_INPUT_INVALID',detail:'입력 검증 실패'},{status:422})).mockResolvedValueOnce(Response.json({...wire(3),name:'수정'}))
 const repo=new HttpWorldStudioRepository(fetcher),world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null}
 await expect(repo.saveStudio(world)).rejects.toThrow('입력 검증 실패')
 expect((await repo.saveStudio({...world,name:'수정'})).name).toBe('수정')
 expect(JSON.parse(fetcher.mock.calls[1][1].body).key).not.toBe(JSON.parse(fetcher.mock.calls[0][1].body).key)
})
it('allows rereading and saving a fresh revision after an explicit no-write conflict',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({code:'WORLD_WRITE_REJECTED',detail:'저장되지 않았습니다. 최신 상태를 다시 조회하세요.'},{status:409})).mockResolvedValueOnce(Response.json(wire(3))).mockResolvedValueOnce(Response.json({...wire(4),name:'수정'}))
 const repo=new HttpWorldStudioRepository(fetcher),world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null}
 await expect(repo.saveStudio(world)).rejects.toThrow('최신 상태')
 const fresh=await repo.read(id)
 expect((await repo.saveStudio({...fresh,name:'수정'})).version).toBe(4)
 const first=JSON.parse(fetcher.mock.calls[0][1].body),next=JSON.parse(fetcher.mock.calls[2][1].body)
 expect(next.expectedDraftRevision).toBe(3);expect(next.key).not.toBe(first.key)
})
it.each([
 [409,'WORLD_CONFLICT'],[409,'RELATIONSHIP_VERSION_MISMATCH'],[503,'RELATIONSHIP_WRITE_INCOMPLETE'],
 [503,'WORLD_WRITE_UNCONFIRMED'],[409,undefined],[503,'WORLD_WRITE_REJECTED'],
])('preserves the exact pending body for an ambiguous %s %s',async(status,code)=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({code,detail:'저장 미확인'},{status})).mockResolvedValueOnce(Response.json(wire(3)))
 const repo=new HttpWorldStudioRepository(fetcher),world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null}
 await expect(repo.saveStudio(world)).rejects.toThrow('저장 미확인')
 await expect(repo.saveStudio({...world,version:3,name:'다른 입력'})).rejects.toThrow('같은 입력')
 await repo.saveStudio(world)
 expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body)
})
it('propagates the caller cancellation signal to a mutation',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json(wire(3))),controller=new AbortController()
 const world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null}
 await new HttpWorldStudioRepository(fetcher).saveStudio(world,controller.signal)
 controller.abort();expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
})
it('reuses the world UUID after a lost create response',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('network')).mockImplementationOnce(async(_url:string,init:RequestInit)=>Response.json({...wire(0),worldId:JSON.parse(String(init.body)).id,cards:[],relationships:[],relationshipVersion:0}))
 const repo=new HttpWorldStudioRepository(fetcher)
 await expect(repo.create('세계관','설명')).rejects.toThrow()
 const created=await repo.create('세계관','설명')
 expect(created.id).toBe(JSON.parse(fetcher.mock.calls[0][1].body).id)
 expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body)
})
it.each(['incomplete','migration_required','not_recorded'])('does not render %s as an empty successful graph',async status=>{
 const repo=new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json({...wire(),relationships:[],relationshipStatus:status})))
 await expect(repo.read(id)).rejects.toThrow('응답')
})
it('rejects another world and invalid relation endpoints instead of installing stale success',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({...wire(),worldId:crypto.randomUUID()})).mockResolvedValueOnce(Response.json({...wire(),relationships:[{...wire().relationships[0],targetCardId:crypto.randomUUID()}]}))
 const repo=new HttpWorldStudioRepository(fetcher)
 await expect(repo.read(id)).rejects.toThrow();await expect(repo.read(id)).rejects.toThrow()
})
it.each([401,403,409,503])('preserves explicit server errors (%s), never falls back to memory',async status=>{
 const repo=new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json({detail:'미완료: 같은 입력을 보존하세요.'},{status})))
 await expect(repo.read(id)).rejects.toThrow()
})
