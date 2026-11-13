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
 const cards=response.cards.map((c,i)=>({...c,semanticMetadata:{studio:{...c.semanticMetadata.studio,templateOrder:10-i*8}}}))
 const fetcher=vi.fn().mockImplementation(async(_path:string,init:RequestInit)=>Response.json({...response,cards,draftRevision:init.method==='GET'?2:3}))
 const repo=new HttpWorldStudioRepository(fetcher)
 const loaded=await repo.read(id)
 expect(loaded.settings.map(s=>s.item.id)).toEqual([b.item.id,a.item.id])
 await repo.saveStudio(loaded)
 const body=JSON.parse(fetcher.mock.calls[1][1].body)
 expect(body.cards.map((c:{semanticMetadata:{studio:{templateOrder:number}}})=>c.semanticMetadata.studio.templateOrder)).toEqual([2,10])
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

it.each(['directed','symmetric'] as const)('reads 6-B partial metadata and preserves %s relations on full replacement',async direction=>{
 const generated=crypto.randomUUID(),analysisId=crypto.randomUUID(),candidateId=crypto.randomUUID()
 const preprocessing={semanticType:'goal',provenance:'ai_extraction',analysisId,candidateId,decisionSequence:2,basisDraftRevision:1,evidence:[{sourceId:'description',start:0,end:2,quote:'원문',quoteHash:'a'.repeat(64)}],condition:'조건',timeText:'미래',polarity:'asserted'}
 const server={...wire(),cards:[...wire().cards,{id:generated,title:'홍길동의 목표',body:'새 나라를 세우려 한다',cardType:'other',areaCode:'basic',classification:'',aliases:[],tags:[],semanticMetadata:{preprocessing,studio:{item:{id:generated,kind:'note',subjectId:a.item.id,relatedIds:[b.item.id]}}},visibility:'private',lifecycle:'active'}],relationships:[{...wire().relationships[0],direction,semanticMetadata:{preprocessing:{...preprocessing,semanticType:'relation'},studio:{item:{id:relation.item.id,kind:'note',subjectId:null,relatedIds:[]}}}}]}
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(server)).mockImplementationOnce(async(_url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));return Response.json({...server,...body,draftRevision:3})
 })
 const repo=new HttpWorldStudioRepository(fetcher),loaded=await repo.read(id)
 expect(loaded.settings[2].item).toMatchObject({kind:'fact',subjectId:a.item.id,relatedIds:[b.item.id]})
 expect(loaded.settings[3].item).toMatchObject({kind:'relation',predicate:direction==='directed'?'custom_emotion':'preserved_emotion_symmetric',subjectId:a.item.id,targetId:b.item.id,polarity:'denied'})
 const saved=await repo.saveStudio(loaded),body=JSON.parse(fetcher.mock.calls[1][1].body)
 expect(body.cards[2].semanticMetadata.preprocessing).toEqual(preprocessing)
 expect(body.relationships[0]).toMatchObject({category:'emotional',direction,polarity:'denied',body:'원문 관계'})
 expect(body.relationships[0].semanticMetadata.preprocessing).toEqual({...preprocessing,semanticType:'relation'})
 expect(saved.settings[2].item.kind).toBe('fact')
 expect(saved.settings.slice(0,2)).toEqual([a,b])
})

const revisionId=crypto.randomUUID()
const confirmed=()=>({worldId:id,revisionId,revisionNo:1,name:'확정 이름',description:'확정 원문',parentRevisionId:null,restoredFromRevisionId:null,cards:wire().cards.map(card=>({versionId:crypto.randomUUID(),versionNo:1,restoredFromVersionId:null,card})),relationships:null,relationshipStatus:'not_recorded'})
it('reads immutable revision cards separately and refuses current relations in history',async()=>{
 const snapshot=confirmed(),fetcher=vi.fn().mockResolvedValueOnce(Response.json([{worldId:id,revisionId,revisionNo:1,name:'확정 이름',createdAt:'2026-11-11T00:00:00Z'}])).mockResolvedValueOnce(Response.json(snapshot)).mockResolvedValueOnce(Response.json({...snapshot,relationships:wire().relationships}))
 const repo=new HttpWorldStudioRepository(fetcher)
 expect(await repo.revisions(id)).toHaveLength(1)
 expect((await repo.revision(id,revisionId)).description).toBe('확정 원문')
 await expect(repo.revision(id,revisionId)).rejects.toThrow()
})
it('retains the exact confirmation key across response loss and repository recreation until acknowledged',async()=>{
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)})
 const fetcher=vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(Response.json(confirmed()))
 let repo=new HttpWorldStudioRepository(fetcher)
 await expect(repo.confirm(id,2)).rejects.toThrow()
 repo=new HttpWorldStudioRepository(fetcher)
 await expect(repo.confirm(id,3)).rejects.toThrow('같은 입력')
 expect((await repo.confirm(id,2)).revisionId).toBe(revisionId)
 expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
 expect(repo.pendingConfirmation(id)).toEqual({expectedDraftRevision:2,key:expect.any(String)})
 repo.acknowledgeConfirmation(id);expect(repo.pendingConfirmation(id)).toBeNull()
})

it('releases only a definitely rejected stale confirmation, allowing a deliberate new request on refreshed draft',async()=>{
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)})
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({code:'WORLD_CONFLICT',detail:'초안이 변경되었습니다.'},{status:409})).mockResolvedValueOnce(Response.json(confirmed()))
 const repo=new HttpWorldStudioRepository(fetcher)
 await expect(repo.confirm(id,2)).rejects.toThrow('변경');expect(repo.pendingConfirmation(id)).toBeNull()
 await repo.confirm(id,3);expect(JSON.parse(fetcher.mock.calls[1][1].body).key).not.toBe(JSON.parse(fetcher.mock.calls[0][1].body).key)
})

it('acknowledges only the current owner/world and creates a fresh key only on a later explicit confirmation',async()=>{
 const otherWorld=`storyfork:confirmation:writer:${crypto.randomUUID()}`
 const otherOwner=`storyfork:confirmation:other:${id}`
 const values=new Map([[otherWorld,'other-world-request'],[otherOwner,'other-owner-request']])
 vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)})
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(confirmed()))
 const repo=new HttpWorldStudioRepository(fetcher)
 await repo.confirm(id,2)
 const original=repo.pendingConfirmation(id)
 repo.acknowledgeConfirmation(id)
 expect(values.get(otherWorld)).toBe('other-world-request');expect(values.get(otherOwner)).toBe('other-owner-request')
 expect(fetcher).toHaveBeenCalledTimes(1);expect(repo.pendingConfirmation(id)).toBeNull()
 await repo.confirm(id,4)
 expect(repo.pendingConfirmation(id)?.expectedDraftRevision).toBe(4)
 expect(repo.pendingConfirmation(id)?.key).not.toBe(original?.key)
})

// ── 세계관 단위 공개 설정(공개 범위·장르) ──────────────────────────────────────
const published=(over={})=>({worldId:id,visibility:'public',genre:'fantasy',publishedAt:'2026-11-12T01:02:03Z',listed:true,...over})
it('puts the publication change with CSRF and maps the 200 result',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json(published()))
 const controller=new AbortController()
 const result=await new HttpWorldStudioRepository(fetcher).setPublication(id,{visibility:'public',genre:'fantasy'},controller.signal)
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(`/api/v1/world-studios/${id}/publication`)
 expect(init.method).toBe('PUT')
 expect(init.headers).toEqual(expect.objectContaining({Authorization:'Bearer studio-bearer','X-CSRF-TOKEN':'studio-csrf'}))
 expect(JSON.parse(init.body)).toEqual({visibility:'public',genre:'fantasy'})
 expect(result).toEqual(published())
 controller.abort();expect(init.signal.aborted).toBe(true)
})
it('sends an unset genre as null and maps a private or unlisted result',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(published({genre:null,listed:false}))).mockResolvedValueOnce(Response.json(published({visibility:'private',genre:null,publishedAt:null,listed:false})))
 const repo=new HttpWorldStudioRepository(fetcher)
 expect(await repo.setPublication(id,{visibility:'public',genre:null})).toMatchObject({visibility:'public',genre:null,listed:false})
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({visibility:'public',genre:null})
 expect(await repo.setPublication(id,{visibility:'private',genre:null})).toEqual(published({visibility:'private',genre:null,publishedAt:null,listed:false}))
})
it.each([
 [404,'WORLD_NOT_FOUND','세계관을 찾을 수 없습니다.'],[422,'WORLD_INPUT_INVALID','세계관 장르를 확인하세요.'],
])('reports the server detail when the publication change is rejected (%s)',async(status,code,detail)=>{
 const repo=new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json({code,detail},{status})))
 await expect(repo.setPublication(id,{visibility:'public',genre:'sf'})).rejects.toThrow(detail)
})
it('does not report success for a malformed publication result or another world',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(published({visibility:'hidden'}))).mockResolvedValueOnce(Response.json(published({genre:'horror'}))).mockResolvedValueOnce(Response.json(published({worldId:crypto.randomUUID()})))
 const repo=new HttpWorldStudioRepository(fetcher)
 for(let i=0;i<3;i++)await expect(repo.setPublication(id,{visibility:'public',genre:null})).rejects.toThrow('응답')
})
it('reads the world visibility and genre, and treats a response without them as private with no genre',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wire()))
 const repo=new HttpWorldStudioRepository(fetcher)
 expect(await repo.read(id)).toMatchObject({visibility:'private',genre:null})
 fetcher.mockImplementation(async()=>Response.json({...wire(),visibility:'public',genre:'sf'}))
 expect(await repo.read(id)).toMatchObject({visibility:'public',genre:'sf'})
 fetcher.mockImplementation(async()=>Response.json({...wire(),visibility:'public',genre:'horror'}))
 await expect(repo.read(id)).rejects.toThrow('응답')
})
it('maps the publication of each summary in the list and defaults an older summary to private',async()=>{
 const other=crypto.randomUUID()
 const row=(worldId:string,extra={})=>({worldId,name:'세계관',description:'',draftRevision:1,relationshipStatus:'current',...extra})
 const repo=new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json([row(id,{visibility:'public',genre:'romance'}),row(other)])))
 expect((await repo.listStudio()).map(w=>[w.id,w.visibility,w.genre])).toEqual([[id,'public','romance'],[other,'private',null]])
})
it('never sends the world publication with a draft save and keeps the one the server returns',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({...wire(3),visibility:'public',genre:'mystery'}))
 const world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null,visibility:'private',genre:null}
 const saved=await new HttpWorldStudioRepository(fetcher).saveStudio(world)
 const body=JSON.parse(fetcher.mock.calls[0][1].body)
 expect(body).not.toHaveProperty('visibility');expect(body).not.toHaveProperty('genre')
 expect(saved).toMatchObject({visibility:'public',genre:'mystery'})
})

// ── 세계관 표지(소유자 업로드·교체·삭제·읽기, 계약: PUT·DELETE·GET /api/v1/world-studios/{id}/cover) ───
const png=()=>new File(['png-bytes'],'cover.png',{type:'image/png'})
it('reads hasCover of the world and of each summary, defaulting an older response to no cover',async()=>{
 const other=crypto.randomUUID()
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wire()))
 const repo=new HttpWorldStudioRepository(fetcher)
 expect((await repo.read(id)).hasCover).toBe(false)
 fetcher.mockImplementation(async()=>Response.json({...wire(),hasCover:true}))
 expect((await repo.read(id)).hasCover).toBe(true)
 const row=(worldId:string,extra={})=>({worldId,name:'세계관',description:'',draftRevision:1,relationshipStatus:'current',...extra})
 fetcher.mockImplementation(async()=>Response.json([row(id,{hasCover:true}),row(other)]))
 expect((await repo.listStudio()).map(w=>[w.id,w.hasCover])).toEqual([[id,true],[other,false]])
 fetcher.mockImplementation(async()=>Response.json({...wire(),hasCover:'yes'}))
 await expect(repo.read(id)).rejects.toThrow('응답')
})
it('uploads or replaces the cover as multipart file with Bearer and CSRF but no JSON content type',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({worldId:id,hasCover:true}))
 const controller=new AbortController()
 await new HttpWorldStudioRepository(fetcher).setCover(id,png(),controller.signal)
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(`/api/v1/world-studios/${id}/cover`)
 expect(init.method).toBe('PUT')
 expect(init.headers).toEqual(expect.objectContaining({Authorization:'Bearer studio-bearer','X-CSRF-TOKEN':'studio-csrf'}))
 expect(init.headers).not.toHaveProperty('Content-Type') // multipart 경계는 브라우저가 붙인다
 expect(init.body).toBeInstanceOf(FormData)
 expect((init.body as FormData).get('file')).toMatchObject({name:'cover.png',type:'image/png'})
 controller.abort();expect(init.signal.aborted).toBe(true)
})
it('does not report an upload success for a malformed result or another world, and reports the server detail on rejection',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({worldId:id,hasCover:false})).mockResolvedValueOnce(Response.json({worldId:crypto.randomUUID(),hasCover:true}))
  .mockResolvedValueOnce(Response.json({detail:'PNG·JPEG·WebP 이미지만 올릴 수 있어요.'},{status:422})).mockResolvedValueOnce(Response.json({detail:'세계관을 찾을 수 없습니다.'},{status:404}))
 const repo=new HttpWorldStudioRepository(fetcher)
 for(let i=0;i<2;i++)await expect(repo.setCover(id,png())).rejects.toThrow('응답')
 await expect(repo.setCover(id,png())).rejects.toThrow('PNG·JPEG·WebP 이미지만 올릴 수 있어요.')
 await expect(repo.setCover(id,png())).rejects.toThrow('세계관을 찾을 수 없습니다.')
})
it('deletes the cover with CSRF and accepts the 204 without a body',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:204}))
 await expect(new HttpWorldStudioRepository(fetcher).removeCover(id)).resolves.toBeUndefined()
 const [url,init]=fetcher.mock.calls[0]
 expect([url,init.method]).toEqual([`/api/v1/world-studios/${id}/cover`,'DELETE'])
 expect(init.headers).toEqual(expect.objectContaining({Authorization:'Bearer studio-bearer','X-CSRF-TOKEN':'studio-csrf'}))
 const failing=new HttpWorldStudioRepository(vi.fn().mockResolvedValue(Response.json({detail:'세계관을 찾을 수 없습니다.'},{status:404})))
 await expect(failing.removeCover(id)).rejects.toThrow('세계관을 찾을 수 없습니다.')
})
it('reads the owner cover bytes with Bearer, and reports a missing or empty cover instead of an empty image',async()=>{
 const bytes=new Blob(['png-bytes'],{type:'image/png'})
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(bytes,{status:200,headers:{'Content-Type':'image/png'}})).mockResolvedValueOnce(new Response(null,{status:404})).mockResolvedValueOnce(new Response(new Blob([]),{status:200}))
 const repo=new HttpWorldStudioRepository(fetcher)
 const blob=await repo.readCover(id)
 expect([blob.size,blob.type]).toEqual([9,'image/png'])
 const [url,init]=fetcher.mock.calls[0]
 expect([url,init.method]).toEqual([`/api/v1/world-studios/${id}/cover`,'GET'])
 expect(init.headers).toEqual(expect.objectContaining({Authorization:'Bearer studio-bearer'}))
 await expect(repo.readCover(id)).rejects.toThrow('표지를 찾을 수 없어요.')
 await expect(repo.readCover(id)).rejects.toThrow('확인할 수 없어요')
})
it('rejects a cover request for an id that is not a UUID before sending anything',async()=>{
 const fetcher=vi.fn()
 const repo=new HttpWorldStudioRepository(fetcher)
 await expect(repo.setCover('not-a-uuid',png())).rejects.toThrow()
 await expect(repo.removeCover('not-a-uuid')).rejects.toThrow()
 await expect(repo.readCover('not-a-uuid')).rejects.toThrow()
 expect(fetcher).not.toHaveBeenCalled()
})

// ── 세계관에 연결된 소설(DEC-46 1:1 연결, 서버 응답의 linkedWorkId) ───
it('reads linkedWorkId of the world, of a draft save response and of each summary, defaulting an older response to null',async()=>{
 const other=crypto.randomUUID()
 const fetcher=vi.fn().mockImplementation(async()=>Response.json({...wire(),linkedWorkId:'work-1'}))
 const repo=new HttpWorldStudioRepository(fetcher)
 expect((await repo.read(id)).linkedWorkId).toBe('work-1')
 fetcher.mockImplementation(async()=>Response.json(wire()))
 expect((await repo.read(id)).linkedWorkId).toBeNull()
 fetcher.mockImplementation(async()=>Response.json({...wire(3),linkedWorkId:'work-1'}))
 const world:StudioWorld={id,name:'세계관',description:'설명',version:2,settings:[a,b,relation],analysis:null}
 expect((await repo.saveStudio(world)).linkedWorkId).toBe('work-1')
 const row=(worldId:string,extra={})=>({worldId,name:'세계관',description:'',draftRevision:1,relationshipStatus:'current',...extra})
 fetcher.mockImplementation(async()=>Response.json([row(id,{linkedWorkId:'work-1'}),row(other,{linkedWorkId:null}),row(crypto.randomUUID())]))
 expect((await repo.listStudio()).map(w=>w.linkedWorkId)).toEqual(['work-1',null,null])
 fetcher.mockImplementation(async()=>Response.json({...wire(),linkedWorkId:7}))
 await expect(repo.read(id)).rejects.toThrow('응답')
})

// ── 카드 단위 공개·독자 공개 회차·가져온 출처(DEC-46): 카드 visibility 필드와 semanticMetadata 최상위 키 ───
const from={worldId:crypto.randomUUID(),worldName:'원본 세계',authorNickname:'원작자',revisionNo:3,cardId:crypto.randomUUID()}
/** 서버 카드 한 장을 덮어쓴 응답. 첫 카드(가)만 바꾼다. */
const wireWith=(card:Record<string,unknown>,version=2)=>{const value=wire(version);return {...value,cards:[{...value.cards[0],...card},value.cards[1]]}}
const savedBody=async(settings:StudioWorld['settings'])=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wire(3)))
 await new HttpWorldStudioRepository(fetcher).saveStudio({id,name:'세계관',description:'설명',version:2,settings,analysis:null})
 return JSON.parse(fetcher.mock.calls[0][1].body) as {cards:{body:string;cardType:string;visibility:string;semanticMetadata:Record<string,unknown>&{studio:Record<string,unknown>}}[]}
}
it('saves each card visibility from its row and keeps the reader reveal episode and import source as top-level metadata, never inside studio',async()=>{
 const body=await savedBody([{...a,visibility:'public',revealFromEpisode:3,importedFrom:from},b,relation])
 expect(body.cards.map(c=>c.visibility)).toEqual(['public','private']) // 값이 없는 카드는 비공개다
 expect(body.cards[0].semanticMetadata).toMatchObject({revealFromEpisode:3,importedFrom:from})
 expect(Object.keys(body.cards[0].semanticMetadata.studio).sort()).toEqual(['item','tags','userCategory'])
 expect(Object.keys(body.cards[1].semanticMetadata)).toEqual(['studio']) // 값이 없으면 키를 넣지 않는다
})
it('reads a public card, its reader reveal episode and import source into row fields and leaves a private card without them',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wireWith({visibility:'public',semanticMetadata:{studio:a,revealFromEpisode:3,importedFrom:from}})))
 const loaded=await new HttpWorldStudioRepository(fetcher).read(id)
 expect(loaded.settings[0]).toEqual({...a,visibility:'public',revealFromEpisode:3,importedFrom:from})
 expect(Object.keys(loaded.settings[0])).not.toContain('serverMetadata') // 두 키는 행 필드가 정본이라 서버 메타데이터로 남기지 않는다
 expect(Object.keys(loaded.settings[1]).sort()).toEqual(['item','tags','userCategory'])
})
it.each([['3'],[0],[-1],[1.5],[null]])('drops a malformed reader reveal episode (%j) and a malformed import source without failing the load',async(revealFromEpisode)=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wireWith({semanticMetadata:{studio:a,revealFromEpisode,importedFrom:{...from,revisionNo:'3'}}})))
 expect((await new HttpWorldStudioRepository(fetcher).read(id)).settings).toEqual([a,b,relation])
})
it('treats the row as the source of truth: a cleared reveal episode or import source is not revived from other server metadata on the next save',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wireWith({visibility:'public',semanticMetadata:{studio:a,kept:'서버 값',revealFromEpisode:3,importedFrom:from}})))
 const [row]=(await new HttpWorldStudioRepository(fetcher).read(id)).settings
 expect(row).toMatchObject({visibility:'public',revealFromEpisode:3,importedFrom:from,serverMetadata:{kept:'서버 값'}})
 const kept=(await savedBody([row,b,relation])).cards[0]
 expect([kept.visibility,kept.semanticMetadata.kept,kept.semanticMetadata.revealFromEpisode,kept.semanticMetadata.importedFrom]).toEqual(['public','서버 값',3,from]) // 그대로 저장하면 그대로 보낸다
 const {visibility:_visibility,revealFromEpisode:_reveal,importedFrom:_from,...cleared}=row
 const sent=(await savedBody([cleared,b,relation])).cards[0]
 expect(sent.visibility).toBe('private')
 expect(Object.keys(sent.semanticMetadata).sort()).toEqual(['kept','studio'])
 expect((await savedBody([{...row,revealFromEpisode:5},b,relation])).cards[0].semanticMetadata.revealFromEpisode).toBe(5)
})

// ── 인물 문서(SOUL.md·MEMORY.md·회차별 기억): 인물 카드 semanticMetadata의 최상위 키 characterDocs. IDENTITY.md는 카드 본문(body)이다 ───
const docs={soul:'말수가 적다',memory:'스승의 유언',episodes:{0:'프롤로그의 기억',3:'스승을 잃었다'}}
const noDocs={soul:'',memory:'',episodes:{}}
/** 가를 장소 카드로 바꾼 행(인물이 아닌 카드). 관계의 양 끝은 그대로라 저장·읽기 검사를 지난다. */
const place={...a,item:{...a.item,entityType:'location'}}
it('saves the character documents of a character card as top-level metadata, never inside studio, and omits the key when every document is empty',async()=>{
 const body=await savedBody([{...a,characterDocs:docs},{...b,characterDocs:noDocs},relation])
 expect(body.cards[0].semanticMetadata.characterDocs).toEqual(docs)
 expect(body.cards[0].body).toBe('원문\n보존') // IDENTITY.md는 카드 본문 그대로다
 expect(Object.keys(body.cards[0].semanticMetadata.studio).sort()).toEqual(['item','tags','userCategory'])
 expect(Object.keys(body.cards[1].semanticMetadata)).toEqual(['studio']) // 전부 비어 있으면 키를 넣지 않는다
})
it('keeps an empty episode memory the author created, and does not save character documents for a card that is not a character',async()=>{
 const created=(await savedBody([{...a,characterDocs:{...noDocs,episodes:{3:''}}},b,relation])).cards[0]
 expect(created.semanticMetadata.characterDocs).toEqual({...noDocs,episodes:{3:''}})
 const other=(await savedBody([{...place,characterDocs:docs},b,relation])).cards[0]
 expect(other.cardType).toBe('location')
 expect(Object.keys(other.semanticMetadata)).toEqual(['studio'])
})
it('reads the character documents of a character card into the row field and leaves other cards without it',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wireWith({semanticMetadata:{studio:a,characterDocs:docs}})))
 const loaded=await new HttpWorldStudioRepository(fetcher).read(id)
 expect(loaded.settings[0]).toEqual({...a,characterDocs:docs})
 expect(Object.keys(loaded.settings[0])).not.toContain('serverMetadata') // 행 필드가 정본이라 서버 메타데이터로 남기지 않는다
 expect(Object.keys(loaded.settings[1]).sort()).toEqual(['item','tags','userCategory'])
})
it.each([
 ['글'],[{soul:1,memory:'',episodes:{}}],[{soul:'',memory:''}],[{soul:'',memory:'',episodes:['기억']}],[{soul:'',memory:'',episodes:{'-1':'기억'}}],
 [{soul:'',memory:'',episodes:{'1.5':'기억'}}],[{soul:'',memory:'',episodes:{'03':'기억'}}],[{soul:'',memory:'',episodes:{3:7}}],[null],
])('drops malformed character documents (%j) without failing the load',async(characterDocs)=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wireWith({semanticMetadata:{studio:a,characterDocs}})))
 expect((await new HttpWorldStudioRepository(fetcher).read(id)).settings).toEqual([a,b,relation])
})
it('ignores character documents stored on a card that is not a character',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wireWith({cardType:'location',semanticMetadata:{studio:place,characterDocs:docs}})))
 const [row]=(await new HttpWorldStudioRepository(fetcher).read(id)).settings
 expect(row).toEqual(place)
 expect(Object.keys(row).sort()).toEqual(['item','tags','userCategory'])
})
it('treats the row as the source of truth for character documents: a deleted episode memory or cleared documents are not revived from server metadata on the next save',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(wireWith({semanticMetadata:{studio:a,kept:'서버 값',characterDocs:docs}})))
 const [row]=(await new HttpWorldStudioRepository(fetcher).read(id)).settings
 expect(row).toMatchObject({characterDocs:docs,serverMetadata:{kept:'서버 값'}})
 expect(row.serverMetadata).not.toHaveProperty('characterDocs')
 const kept=(await savedBody([row,b,relation])).cards[0].semanticMetadata
 expect([kept.kept,kept.characterDocs]).toEqual(['서버 값',docs]) // 그대로 저장하면 그대로 보낸다
 const fewer={...docs,episodes:{0:'프롤로그의 기억'}}
 expect((await savedBody([{...row,characterDocs:fewer},b,relation])).cards[0].semanticMetadata.characterDocs).toEqual(fewer) // 지운 3회차 기억은 돌아오지 않는다
 const cleared=(await savedBody([{...row,characterDocs:noDocs},b,relation])).cards[0].semanticMetadata
 expect(Object.keys(cleared).sort()).toEqual(['kept','studio'])
})
