import type {StudioWorld,WorldRevision,WorldRevisionSummary} from '../entities/studioWorld'
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
}
