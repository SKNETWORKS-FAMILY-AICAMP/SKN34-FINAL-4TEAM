export type ManuscriptBuild = {
 jobId:string;worldId:string;status:'queued'|'running'|'failed'|'loading'|'unknown'|'completed'
 completedEpisodes:number;totalEpisodes:number;executionToken:string|null;failureCode:string|null
 /** 근거를 확인하지 못해 초안에 넣지 않은 항목 수(모든 회차의 합). */
 skippedItems:number
 /** 작업을 접수한 요청 key. 업로드가 서버에서 시작한 작업은 `import:<uuid>`라 이 브라우저에 요청 기록이 없다: 같은 작업 재개는 이 key로 한다. */
 requestKey:string
 receipts:{jobId:string;stepId:string;worldId:string;draftRevision:number;relationshipVersion:number;cardIds:string[];relationshipIds:string[]}[]
}
export interface ManuscriptBuildRepository {
 read(workId:string,signal?:AbortSignal):Promise<ManuscriptBuild|null>
 /** fresh=true는 저장된 요청 기록을 버리고 새 key로 접수한다(실패한 작업 뒤의 '새로 시작'). */
 start(workId:string,worldId?:string|null,signal?:AbortSignal,fresh?:boolean):Promise<ManuscriptBuild>
 resume(workId:string,signal?:AbortSignal):Promise<ManuscriptBuild>
}
