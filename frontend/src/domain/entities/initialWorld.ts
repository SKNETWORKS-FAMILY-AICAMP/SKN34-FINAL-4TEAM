export type Candidate={localRef:string;type:'fact'|'relation'|'rule'|'event'|'conjecture'|'goal'|'plan';title:string;text:string;subjectId:string|null;relatedEntityIds:string[];provenance:'ai_extraction'|'author_revision';evidence:{sourceId:string;start:number;end:number;quote:string;quoteHash:string}[];relation:{sourceCardId:string;targetCardId:string;category:'structural'|'emotional';label:string;direction:'directed'|'symmetric';polarity:'asserted'|'denied'}|null;condition:string;timeText:string;polarity:'asserted'|'denied'}
export type Decision={candidateId:string;candidateRef:string;sequence:number;state:'pending'|'approved'|'held'|'rejected';content:Candidate}
export type Analysis={analysisId:string;basis:{draftRevision:number;relationshipVersion:number;currentRevisionId:string|null;inputHash:string};executionStatus:'running'|'completed'|'failed'|'unknown';freshness:'current'|'stale';output:{schemaVersion:'initial-world.v1';candidates:Candidate[];diagnostics:string[]}|null;candidateIds:Record<string,string>;decisions:Decision[]}
export type Receipt={applicationId:string;status:'applying'|'unknown'|'applied'|'failed';baseDraftRevision:number;resultDraftRevision:number|null;createdCardIds:string[];createdRelationshipIds:string[]}
export type MutationResult=Analysis|Decision|Receipt
export type ReviewAction='approve'|'edit'|'hold'|'reject'
export function currentCandidate(analysis:Analysis,c:Candidate) {
 const id=analysis.candidateIds[c.localRef],latest=analysis.decisions.filter(d=>d.candidateId===id).sort((a,b)=>b.sequence-a.sequence)[0]
 return {id,sequence:latest?.sequence??0,state:latest?.state??'pending',content:latest?.content??c}
}
