import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import '../../test/testLocks'
import {login} from '../api/auth'
import {HttpMediaRepository} from './HttpMediaRepository'
import {MediaUseCase} from '../../domain/usecases/MediaUseCase'

const workId='b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const id='e25ffb25-8128-48c0-8d66-e1d56831cd56'
const target={kind:'setting' as const,workId,settingId:'1eecb1f7-f76d-4688-9793-b73e93899f52'}
const base=`/api/v1/works/${workId}/settings/${target.settingId}/attachments`
const metadata={id,filename:'지도.png',mediaType:'image/png',kind:'IMAGE',byteSize:3,createdAt:'2026-11-03T10:00:00Z',url:`${base}/${id}/content`}
beforeEach(async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/csrf')?Response.json({csrfToken:'media-csrf'}):Response.json({accessToken:'media-bearer',user:{id:'owner',email:'owner@example.invalid',nickname:'Owner',operator:false}})))
 await login('owner@example.invalid','test-password')
})
afterEach(()=>vi.unstubAllGlobals())

it('parses the existing setting attachment list envelope',async()=>{
 const repo=new HttpMediaRepository(vi.fn().mockResolvedValue(Response.json({attachments:[metadata]})))
 expect(await repo.list(target)).toEqual([metadata])
})
it('does not send a mutation if the account changes while csrf is loading',async()=>{
 let resolveCsrf!:(value:Response)=>void
 const waiting=new Promise<Response>(resolve=>{resolveCsrf=resolve})
 const globalFetch=vi.mocked(fetch)
 globalFetch.mockImplementationOnce(()=>waiting)
 const fetcher=vi.fn().mockResolvedValue(Response.json(metadata,{status:201}))
 const pending=new HttpMediaRepository(fetcher).upload(target,new File(['png'],'지도.png'))
 await vi.waitFor(()=>expect(globalFetch).toHaveBeenLastCalledWith('/api/v1/auth/csrf',expect.anything()))
 const rejection=expect(pending).rejects.toThrow('cancelled')
 const signingIn=login('other@example.invalid','test-password')
 resolveCsrf(Response.json({csrfToken:'old-csrf'}))
 await signingIn
 await rejection
 expect(fetcher).not.toHaveBeenCalled()
})
it('uploads multipart with csrf and bearer without a JSON content type',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json(metadata,{status:201}))
 const file=new File(['png'],'지도.png',{type:'image/png'})
 await new MediaUseCase(new HttpMediaRepository(fetcher)).upload(target,file)
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(base)
 expect(init.body).toBeInstanceOf(FormData)
 expect(init.body.get('file').name).toBe('지도.png')
 expect(new Headers(init.headers).get('Content-Type')).toBeNull()
 expect(init.headers).toMatchObject({Authorization:'Bearer media-bearer','X-CSRF-TOKEN':'media-csrf'})
})
it('fetches private bytes with auth, supports abort and never trusts an arbitrary response URL',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response('png',{headers:{'Content-Type':'image/png'}}))
 const controller=new AbortController()
 await new HttpMediaRepository(fetcher).download(target,id,false,controller.signal)
 expect(fetcher.mock.calls[0][0]).toBe(`${base}/${id}/content`)
 expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer media-bearer')
 controller.abort();expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
 fetcher.mockResolvedValue(Response.json({...metadata,url:'https://outside.invalid/token'}))
 await expect(new HttpMediaRepository(fetcher).upload(target,new File(['png'],'지도.png'))).rejects.toThrow('응답')
})
it('uses anonymous public episode reads and surfaces storage errors instead of success',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response('png',{headers:{'Content-Type':'image/png'}}))
 const repo=new HttpMediaRepository(fetcher)
 await repo.download({kind:'episode',workId,number:1},id,true)
 expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/public/works/${workId}/episodes/1/images/${id}/content`)
 expect(new Headers(fetcher.mock.calls[0][1].headers).has('Authorization')).toBe(false)
 fetcher.mockResolvedValue(Response.json({detail:'저장소 연결 실패'},{status:503}))
 await expect(repo.upload(target,new File(['png'],'지도.png'))).rejects.toThrow('저장소 연결 실패')
})
it('rejects demo IDs, empty oversized and incompatible files before sending',async()=>{
 const fetcher=vi.fn();const api=new MediaUseCase(new HttpMediaRepository(fetcher))
 await expect(api.upload({...target,workId:'demo'},new File(['x'],'지도.png'))).rejects.toThrow('작품')
 await expect(api.upload(target,new File([],'지도.png'))).rejects.toThrow('빈 파일')
 await expect(api.upload({kind:'cover',workId},new File(['text'],'note.txt'))).rejects.toThrow('PNG')
 await expect(api.upload(target,new File([new Uint8Array(10485761)],'big.pdf'))).rejects.toThrow('10 MiB')
 expect(fetcher).not.toHaveBeenCalled()
})
