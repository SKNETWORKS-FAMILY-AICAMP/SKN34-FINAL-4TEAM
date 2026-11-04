import type {Attachment,MediaTarget} from '../entities/media'

export interface MediaRepository {
 list(target:MediaTarget,signal?:AbortSignal):Promise<Attachment[]>
 upload(target:MediaTarget,file:File,replaceId?:string,signal?:AbortSignal):Promise<Attachment>
 remove(target:MediaTarget,id:string,signal?:AbortSignal):Promise<void>
 download(target:MediaTarget,id:string,publicView?:boolean,signal?:AbortSignal):Promise<Blob>
}
