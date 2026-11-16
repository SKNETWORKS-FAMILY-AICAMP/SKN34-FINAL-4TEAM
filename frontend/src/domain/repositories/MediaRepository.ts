import type {Attachment,EpisodeImage,MediaTarget} from '../entities/media'

export interface MediaRepository {
 list(target:MediaTarget,signal?:AbortSignal):Promise<Attachment[]>
 upload(target:MediaTarget,file:File,replaceId?:string,signal?:AbortSignal):Promise<Attachment>
 remove(target:MediaTarget,id:string,signal?:AbortSignal):Promise<void>
 rename(target:MediaTarget,id:string,filename:string,signal?:AbortSignal):Promise<Attachment>
 listEpisodeImages(workId:string,number:number,signal?:AbortSignal):Promise<EpisodeImage[]>
 updateEpisodeImageAlt(workId:string,number:number,imageId:string,altText:string,signal?:AbortSignal):Promise<EpisodeImage>
 /** 공개 작품 발행본이 참조하는 이미지의 대체 텍스트(이미지 ID → 설명). 익명으로 조회한다. */
 publicEpisodeImageAlts(workId:string,number:number,signal?:AbortSignal):Promise<Record<string,string>>
 download(target:MediaTarget,id:string,publicView?:boolean,signal?:AbortSignal):Promise<Blob>
}
