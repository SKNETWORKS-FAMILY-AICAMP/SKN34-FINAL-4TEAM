export type ManuscriptBuild = {
 jobId:string;worldId:string;status:'queued'|'running'|'failed'|'loading'|'unknown'|'completed'
 completedEpisodes:number;totalEpisodes:number;executionToken:string|null;failureCode:string|null
 /** 근거를 확인하지 못해 초안에 넣지 않은 항목 수(모든 회차의 합). */
 skippedItems:number
 receipts:{jobId:string;stepId:string;worldId:string;draftRevision:number;relationshipVersion:number;cardIds:string[];relationshipIds:string[]}[]
}
export interface ManuscriptBuildRepository {
 read(workId:string,signal?:AbortSignal):Promise<ManuscriptBuild|null>
 /** fresh=true는 저장된 요청 기록을 버리고 새 key로 접수한다(실패한 작업 뒤의 '새로 시작'). */
 start(workId:string,worldId?:string|null,signal?:AbortSignal,fresh?:boolean):Promise<ManuscriptBuild>
 resume(workId:string,signal?:AbortSignal):Promise<ManuscriptBuild>
}
