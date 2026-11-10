export type RunSelection={start:number;end:number;revision:number;sourceHash:string}
export type RunInput={operation:'ask'|'review'|'edit'|'next_draft';prompt:string;target:{basisEpisode:number;forkId:string|null;character:string;baseRevision:number;selection?:RunSelection};options:{modelConsent:{providers:string[];purpose:string;maxCalls:number;noticeVersion:string}}}
export type AiRun={runId:string;threadId:string;workId:string;status:string;lastEventId:number;error?:{code:string;retryable:boolean}|null;result?:{proposalId?:string|null;isMock:boolean}|null}
export type Progress={runId:string;seq:number;code:string;message:string}
export type RunDetails={status:string;text:string;isMock:boolean;citations:{quote:string;episode:number}[];coverage:{expectedCount:number;verifiedCount:number;gaps:string[]}|null}
export type ChangeProposal={proposalHash:string;status:string;changeSet:{proposalId:string;proposalVersion:number;runId:string;isMock:boolean;affectedDocuments:{id:string;baseVersion:number|null}[];operations:{op:string;target:{id:string;episode:number;baseVersion:number|null};span:{start:number;end:number}|null;content:string|null;fields:{name:string;value:string}[]}[];evidence:{id:string;isMock:boolean;sourceHash:string;span:{start:number;end:number}}[]}}
export type Decision={outcome:string;decisionId:string}
export interface AiRunRepository {
  session():number
  metadata(work:string,signal:AbortSignal):Promise<{revision:number;source:{workId:string}|null}>
  create(work:string,input:RunInput,key:string,signal:AbortSignal):Promise<AiRun>
  status(work:string,run:string,signal:AbortSignal):Promise<AiRun>
  details(work:string,run:string,signal:AbortSignal):Promise<RunDetails>
  cancel(work:string,run:string,signal:AbortSignal):Promise<AiRun>
  proposal(work:string,id:string,signal:AbortSignal):Promise<ChangeProposal>
  decide(work:string,proposal:ChangeProposal,action:'approve'|'reject'|'revise',key:string,signal:AbortSignal):Promise<Decision>
  watch(work:string,run:string,cursor:number,signal:AbortSignal,onEvent:(event:Progress)=>void,onConnection:(connected:boolean)=>void):Promise<void>
}
