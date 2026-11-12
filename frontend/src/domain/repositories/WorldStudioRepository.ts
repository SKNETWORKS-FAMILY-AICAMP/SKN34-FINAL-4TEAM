import type {StudioWorld,WorldPublication,WorldPublicationInput,WorldRevision,WorldRevisionSummary} from '../entities/studioWorld'
export interface WorldStudioRepository {
 revisions?(id:string,signal?:AbortSignal):Promise<WorldRevisionSummary[]>
 revision?(id:string,revisionId:string,signal?:AbortSignal):Promise<WorldRevision>
 confirm?(id:string,expected:number,signal?:AbortSignal):Promise<WorldRevision>
 pendingConfirmation?(id:string):{expectedDraftRevision:number;key:string}|null
 acknowledgeConfirmation?(id:string):void
 listStudio(signal?:AbortSignal):Promise<StudioWorld[]>
 read(id:string,signal?:AbortSignal):Promise<StudioWorld>
 create(name:string,description:string,signal?:AbortSignal):Promise<StudioWorld>
 saveStudio(world:StudioWorld,signal?:AbortSignal):Promise<StudioWorld>
 /** 세계관 단위 공개 범위·장르. 초안 저장(saveStudio)과 별개로 바로 적용된다. */
 setPublication(id:string,publication:WorldPublicationInput,signal?:AbortSignal):Promise<WorldPublication>
 /** 세계관 표지(소유자). 업로드는 교체를 겸한다. 서버 저장소가 없는 데모는 구현하지 않는다. */
 setCover?(id:string,file:File,signal?:AbortSignal):Promise<void>
 removeCover?(id:string,signal?:AbortSignal):Promise<void>
 readCover?(id:string,signal?:AbortSignal):Promise<Blob>
}
