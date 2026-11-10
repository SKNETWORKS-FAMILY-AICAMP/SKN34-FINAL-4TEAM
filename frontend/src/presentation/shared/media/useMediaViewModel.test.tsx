// @vitest-environment jsdom
import {act,renderHook,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {useStoredImage,useMediaViewModel} from './useMediaViewModel'

const workId='b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const target={kind:'cover' as const,workId}
const settingTarget={kind:'setting' as const,workId,settingId:'1eecb1f7-f76d-4688-9793-b73e93899f52'}
const item={id:'e25ffb25-8128-48c0-8d66-e1d56831cd56',filename:'old.png',mediaType:'image/png',kind:'IMAGE' as const,byteSize:3,createdAt:'2026-11-03T10:00:00Z',url:'/unused'}
afterEach(()=>vi.unstubAllGlobals())
it('keeps the old cover on upload failure and prevents duplicate pending mutations',async()=>{
 let rejectUpload:(e:Error)=>void=()=>{}
 const upload=vi.fn(()=>new Promise<typeof item>((_,reject)=>{rejectUpload=reject}))
 const api={list:vi.fn().mockResolvedValue([item]),upload,remove:vi.fn(),download:vi.fn(),rename:vi.fn()}
 const {result}=renderHook(()=>useMediaViewModel(target,api))
 await waitFor(()=>expect(result.current.items).toEqual([item]))
 let pending:Promise<unknown>
 act(()=>{pending=result.current.upload(new File(['png'],'new.png'))})
 await act(async()=>{await result.current.upload(new File(['png'],'duplicate.png'))})
 expect(upload).toHaveBeenCalledTimes(1)
 await act(async()=>{rejectUpload(new Error('저장소 오류'));await pending})
 expect(result.current.items).toEqual([item]);expect(result.current.error).toBe('저장소 오류')
})
it('cancels an upload without applying its late success and can reload the real server state',async()=>{
 let resolve!:(value:typeof item)=>void
 let signal:AbortSignal|undefined
 const api={list:vi.fn().mockResolvedValue([item]),upload:vi.fn((_target:unknown,_file:File,_replace?:string,s?:AbortSignal)=>{signal=s;return new Promise<typeof item>(r=>{resolve=r})}),remove:vi.fn(),download:vi.fn(),rename:vi.fn()}
 const {result}=renderHook(()=>useMediaViewModel(target,api))
 await waitFor(()=>expect(result.current.busy).toBe(false))
 let pending!:Promise<unknown>
 act(()=>{pending=result.current.upload(new File(['png'],'new.png'))})
 act(()=>result.current.cancel())
 expect(signal?.aborted).toBe(true)
 await act(async()=>{resolve({...item,filename:'new.png'});await pending})
 expect(result.current.items[0].filename).toBe('old.png')
 expect(result.current.error).toContain('이미 처리')
 api.list.mockResolvedValue([{...item,filename:'server.png'}])
 await act(async()=>{await result.current.reload()})
 expect(result.current.items[0].filename).toBe('server.png')
})
it('uses Blob URLs and revokes them on unmount without applying late responses',async()=>{
 const createObjectURL=vi.fn().mockReturnValue('blob:private-image');const revokeObjectURL=vi.fn()
 vi.stubGlobal('URL',class extends URL {static createObjectURL=createObjectURL;static revokeObjectURL=revokeObjectURL})
 const api={download:vi.fn().mockResolvedValue(new Blob(['png'],{type:'image/png'}))}
 const {result,unmount}=renderHook(()=>useStoredImage(target,item.id,false,0,api))
 await waitFor(()=>expect(result.current.url).toBe('blob:private-image'))
 unmount();expect(revokeObjectURL).toHaveBeenCalledWith('blob:private-image')
 let resolve:(b:Blob)=>void=()=>{}
 api.download.mockImplementation(()=>new Promise<Blob>(r=>{resolve=r}))
 const late=renderHook(()=>useStoredImage(target,item.id,false,0,api));late.unmount()
 await act(async()=>{resolve(new Blob(['late'],{type:'image/png'}))})
 expect(createObjectURL).toHaveBeenCalledTimes(1)
})
it('renames an attachment in place and prevents a duplicate rename while one is pending',async()=>{
 let resolveRename!:(value:typeof item)=>void
 const rename=vi.fn((_target:unknown,_id:string,_name:string,_signal?:AbortSignal)=>new Promise<typeof item>(r=>{resolveRename=r}))
 const api={list:vi.fn().mockResolvedValue([item]),upload:vi.fn(),remove:vi.fn(),download:vi.fn(),rename}
 const {result}=renderHook(()=>useMediaViewModel(settingTarget,api))
 await waitFor(()=>expect(result.current.items).toEqual([item]))
 let pending!:Promise<boolean>
 act(()=>{pending=result.current.rename(item,'new.png')})
 await act(async()=>{await result.current.rename(item,'duplicate.png')})
 expect(rename).toHaveBeenCalledTimes(1)
 expect(rename).toHaveBeenCalledWith(settingTarget,item.id,'new.png',expect.any(AbortSignal))
 await act(async()=>{resolveRename({...item,filename:'new.png'});expect(await pending).toBe(true)})
 expect(result.current.items).toEqual([{...item,filename:'new.png'}])
 expect(result.current.notice).toBe('파일 이름을 바꿨어요.')
 expect(result.current.error).toBe('')
})
it('keeps the old name and shows the server reason when the rename fails',async()=>{
 const api={list:vi.fn().mockResolvedValue([item]),upload:vi.fn(),remove:vi.fn(),download:vi.fn(),rename:vi.fn().mockRejectedValue(new Error('파일 입력을 확인해 주세요.'))}
 const {result}=renderHook(()=>useMediaViewModel(settingTarget,api))
 await waitFor(()=>expect(result.current.items).toEqual([item]))
 let done=true
 await act(async()=>{done=await result.current.rename(item,'new.pdf')})
 expect(done).toBe(false)
 expect(result.current.items).toEqual([item])
 expect(result.current.error).toBe('파일 입력을 확인해 주세요.')
 expect(result.current.notice).toBe('')
 expect(result.current.busy).toBe(false)
})
