import type {StudioWorld,WorldPublication,WorldPublicationInput,WorldRevision,WorldRevisionSummary} from '../entities/studioWorld'
export interface WorldStudioRepository {
 revisions?(id:string,signal?:AbortSignal):Promise<WorldRevisionSummary[]>
 revision?(id:string,revisionId:string,signal?:AbortSignal):Promise<WorldRevision>
 confirm?(id:string,expected:number,signal?:AbortSignal):Promise<WorldRevision>
 pendingConfirmation?(id:string):{expectedDraftRevision:number;key:string}|null
 acknowledgeConfirmation?(id:string):void
 /** 관계를 회차 시점으로 읽고 쓰는지(DEC-51). 서버 저장소만 true이고 메모리 데모는 없다(회차를 받지 않는다). */
 readonly relationEpisodes?:true
 listStudio(signal?:AbortSignal):Promise<StudioWorld[]>
 /** `episode`는 관계의 회차 시점(연결된 소설의 회차 순번, 1 이상)이고 생략하면 최신 회차다. 카드는 회차와 무관하게 현재 초안이다. */
 read(id:string,signal?:AbortSignal,episode?:number):Promise<StudioWorld>
 create(name:string,description:string,signal?:AbortSignal):Promise<StudioWorld>
 /** 받은 관계 전체를 `episode`(생략하면 최신 회차) 시점 값으로 기록한다. 카드 변경은 회차와 무관하게 그대로 저장된다. */
 saveStudio(world:StudioWorld,signal?:AbortSignal,episode?:number):Promise<StudioWorld>
 /** 세계관 단위 공개 범위·장르. 초안 저장(saveStudio)과 별개로 바로 적용된다. */
 setPublication(id:string,publication:WorldPublicationInput,signal?:AbortSignal):Promise<WorldPublication>
 /** 세계관 표지(소유자). 업로드는 교체를 겸한다. 서버 저장소가 없는 데모는 구현하지 않는다. */
 setCover?(id:string,file:File,signal?:AbortSignal):Promise<void>
 removeCover?(id:string,signal?:AbortSignal):Promise<void>
 readCover?(id:string,signal?:AbortSignal):Promise<Blob>
}
