export type ManuscriptBuild = {
 jobId:string;worldId:string;status:'queued'|'running'|'failed'|'loading'|'unknown'|'completed'
 completedEpisodes:number;totalEpisodes:number;executionToken:string|null;failureCode:string|null
 receipts:{jobId:string;stepId:string;worldId:string;draftRevision:number;relationshipVersion:number;cardIds:string[];relationshipIds:string[]}[]
}
export interface ManuscriptBuildRepository {
 read(workId:string,signal?:AbortSignal):Promise<ManuscriptBuild|null>
 start(workId:string,worldId?:string|null,signal?:AbortSignal):Promise<ManuscriptBuild>
 resume(workId:string,signal?:AbortSignal):Promise<ManuscriptBuild>
}
