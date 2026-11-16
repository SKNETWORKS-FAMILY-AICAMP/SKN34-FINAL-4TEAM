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
it('renames a setting attachment with PATCH, csrf and a JSON body, then validates the returned metadata',async()=>{
 const renamed={...metadata,filename:'새 지도.png'}
 const fetcher=vi.fn().mockResolvedValue(Response.json(renamed))
 const controller=new AbortController()
 const result=await new HttpMediaRepository(fetcher).rename(target,id,'새 지도.png',controller.signal)
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(`${base}/${id}`)
 expect(init.method).toBe('PATCH')
 expect(init.body).toBe(JSON.stringify({filename:'새 지도.png'}))
 expect(init.headers).toMatchObject({Authorization:'Bearer media-bearer','X-CSRF-TOKEN':'media-csrf','Content-Type':'application/json'})
 controller.abort();expect(init.signal.aborted).toBe(true)
 expect(result).toEqual(renamed)
 fetcher.mockResolvedValue(Response.json({...renamed,url:'https://outside.invalid/token'}))
 await expect(new HttpMediaRepository(fetcher).rename(target,id,'새 지도.png')).rejects.toThrow('응답')
})
it('surfaces the server detail for a rejected rename and never reports a missing attachment as renamed',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({code:'ATTACHMENT_INVALID',detail:'파일 입력을 확인해 주세요.'},{status:422})).mockResolvedValueOnce(new Response(null,{status:404}))
 const repo=new HttpMediaRepository(fetcher)
 await expect(repo.rename(target,id,'새 지도.pdf')).rejects.toThrow('파일 입력을 확인해 주세요.')
 await expect(repo.rename(target,id,'새 지도.png')).rejects.toThrow('첨부를 찾을 수 없어요')
})
it('rejects demo IDs, empty oversized and incompatible files before sending',async()=>{
 const fetcher=vi.fn();const api=new MediaUseCase(new HttpMediaRepository(fetcher))
 await expect(api.upload({...target,workId:'demo'},new File(['x'],'지도.png'))).rejects.toThrow('작품')
 await expect(api.upload(target,new File([],'지도.png'))).rejects.toThrow('빈 파일')
 await expect(api.upload({kind:'cover',workId},new File(['text'],'note.txt'))).rejects.toThrow('PNG')
 await expect(api.upload(target,new File([new Uint8Array(10485761)],'big.pdf'))).rejects.toThrow('10 MiB')
 expect(fetcher).not.toHaveBeenCalled()
})

const episodeBase=`/api/v1/works/${workId}/episodes/2/images`
const episodeImage={id,filename:'다리.png',mediaType:'image/png',byteSize:3,altText:'강 위의 다리',createdAt:'2026-11-03T10:00:00Z',url:`${episodeBase}/${id}/content`,referenced:true}
it('lists owner episode images from the images envelope, with bearer and no csrf, and never trusts an arbitrary url',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({images:[episodeImage]}))
 const controller=new AbortController()
 const rows=await new HttpMediaRepository(fetcher).listEpisodeImages(workId,2,controller.signal)
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(episodeBase)
 expect(init.method).toBe('GET')
 expect(init.headers).toMatchObject({Authorization:'Bearer media-bearer'})
 expect(init.headers).not.toHaveProperty('X-CSRF-TOKEN')
 controller.abort();expect(init.signal.aborted).toBe(true)
 expect(rows).toEqual([episodeImage])
 const repo=new HttpMediaRepository(fetcher)
 fetcher.mockResolvedValue(Response.json({images:[{...episodeImage,url:'https://outside.invalid/token'}]}))
 await expect(repo.listEpisodeImages(workId,2)).rejects.toThrow('응답')
 fetcher.mockResolvedValue(Response.json({attachments:[episodeImage]}))
 await expect(repo.listEpisodeImages(workId,2)).rejects.toThrow('응답')
 fetcher.mockResolvedValue(Response.json({images:[{...episodeImage,referenced:'yes'}]}))
 await expect(repo.listEpisodeImages(workId,2)).rejects.toThrow('응답')
 fetcher.mockResolvedValue(new Response(null,{status:404}))
 await expect(repo.listEpisodeImages(workId,2)).rejects.toThrow('회차를 찾을 수 없어요')
 fetcher.mockResolvedValue(Response.json({detail:'저장소 연결 실패'},{status:503}))
 await expect(repo.listEpisodeImages(workId,2)).rejects.toThrow('저장소 연결 실패')
})
it('updates the alt text with PATCH, csrf and a JSON body and returns one validated item',async()=>{
 const updated={...episodeImage,altText:'새 설명'}
 const fetcher=vi.fn().mockResolvedValue(Response.json(updated))
 const result=await new HttpMediaRepository(fetcher).updateEpisodeImageAlt(workId,2,id,'새 설명')
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(`${episodeBase}/${id}`)
 expect(init.method).toBe('PATCH')
 expect(init.body).toBe(JSON.stringify({altText:'새 설명'}))
 expect(init.headers).toMatchObject({Authorization:'Bearer media-bearer','X-CSRF-TOKEN':'media-csrf','Content-Type':'application/json'})
 expect(result).toEqual(updated)
 const repo=new HttpMediaRepository(fetcher)
 fetcher.mockResolvedValue(Response.json({...updated,url:`${episodeBase}/other/content`}))
 await expect(repo.updateEpisodeImageAlt(workId,2,id,'새 설명')).rejects.toThrow('응답')
 fetcher.mockResolvedValue(Response.json({code:'IMAGE_INVALID',detail:'이미지 설명에 제어 문자를 쓸 수 없어요.'},{status:422}))
 await expect(repo.updateEpisodeImageAlt(workId,2,id,'x')).rejects.toThrow('제어 문자')
 fetcher.mockResolvedValue(new Response(null,{status:404}))
 await expect(repo.updateEpisodeImageAlt(workId,2,id,'x')).rejects.toThrow('이미지를 찾을 수 없어요')
})
it('reads public alt texts anonymously and maps them by image id',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({images:[{id,altText:'강 위의 다리'},{id:'6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10',altText:''}]}))
 const repo=new HttpMediaRepository(fetcher)
 expect(await repo.publicEpisodeImageAlts(workId,2)).toEqual({[id]:'강 위의 다리','6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10':''})
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(`/api/v1/public/works/${workId}/episodes/2/images`)
 expect(init.method).toBe('GET')
 expect(new Headers(init.headers).has('Authorization')).toBe(false)
 expect(new Headers(init.headers).has('X-CSRF-TOKEN')).toBe(false)
 fetcher.mockResolvedValue(Response.json({images:[{id:'not-a-uuid',altText:'x'}]}))
 await expect(repo.publicEpisodeImageAlts(workId,2)).rejects.toThrow('응답')
 fetcher.mockResolvedValue(new Response(null,{status:404}))
 await expect(repo.publicEpisodeImageAlts(workId,2)).rejects.toThrow('공개 이미지 설명')
})
