import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import '../../test/testLocks'
import {login} from '../api/auth'
import {HttpInitialWorldRepository} from './HttpInitialWorldRepository'
const world=crypto.randomUUID(),analysis=crypto.randomUUID(),candidate=crypto.randomUUID(),application=crypto.randomUUID()
const body={expectedDraftRevision:2,candidates:[{candidateId:candidate,decisionSequence:1}]}
const receipt={applicationId:application,status:'applied',baseDraftRevision:2,resultDraftRevision:3,createdCardIds:[crypto.randomUUID()],createdRelationshipIds:[]}
const memory=new Map<string,string>()
const storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v)},removeItem:(k:string)=>{memory.delete(k)}}
beforeEach(async()=>{memory.clear();vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/csrf')?Response.json({csrfToken:'csrf'}):Response.json({accessToken:'token',user:{id:'writer',email:'writer@example.test',nickname:'writer',operator:false}})));await login('writer@example.test','test')})
afterEach(()=>vi.unstubAllGlobals())
it('persists exact application after response loss, blocks another payload and recovers after repository restart',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(Response.json({...receipt,status:'unknown',resultDraftRevision:null},{status:503})).mockResolvedValueOnce(Response.json(receipt))
 let repo=new HttpInitialWorldRepository(fetcher,storage)
 await expect(repo.mutate(world,`/${analysis}/applications`,body)).rejects.toThrow()
 await expect(repo.mutate(world,`/${analysis}/applications`,{...body,expectedDraftRevision:3})).rejects.toThrow('미확인')
 repo=new HttpInitialWorldRepository(fetcher,storage)
 expect(await repo.resume(world)).toMatchObject({status:'unknown'});expect(repo.pending(world)).not.toBeNull()
 expect(await repo.resume(world)).toMatchObject({status:'applied'});expect(repo.pending(world)).not.toBeNull();repo.acknowledge(world);expect(repo.pending(world)).toBeNull()
 expect(fetcher.mock.calls.map(c=>c[1].body).every(v=>v===fetcher.mock.calls[0][1].body)).toBe(true)
})
it('never sends when durable request storage fails',async()=>{
 const fetcher=vi.fn(),repo=new HttpInitialWorldRepository(fetcher,{...storage,setItem:()=>{throw new Error('quota')}})
 await expect(repo.mutate(world,'',{expectedDraftRevision:2})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled()
})
it('isolates pending requests by authenticated member',async()=>{
 const repo=new HttpInitialWorldRepository(vi.fn().mockRejectedValue(new Error('offline')),storage)
 await expect(repo.mutate(world,'',{expectedDraftRevision:2})).rejects.toThrow()
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/csrf')?Response.json({csrfToken:'csrf'}):Response.json({accessToken:'other',user:{id:'other',email:'other@example.test',nickname:'other',operator:false}})))
 await login('other@example.test','test');expect(repo.pending(world)).toBeNull()
})
