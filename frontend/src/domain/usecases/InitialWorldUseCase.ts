import type {InitialWorldRepository} from '../repositories/InitialWorldRepository'
import {currentCandidate,type Analysis,type Candidate,type ReviewAction} from '../entities/initialWorld'
export class InitialWorldUseCase {
 private readonly repository:InitialWorldRepository
 constructor(repository:InitialWorldRepository){this.repository=repository}
 acknowledge(world:string){this.repository.acknowledge(world)}
 list(world:string,signal?:AbortSignal){return this.repository.list(world,signal)}
 read(world:string,id:string,signal?:AbortSignal){return this.repository.read(world,id,signal)}
 receipt(world:string,analysis:string,id:string,signal?:AbortSignal){return this.repository.receipt(world,analysis,id,signal)}
 pending(world:string){return this.repository.pending(world)}
 resume(world:string,signal?:AbortSignal){return this.repository.resume(world,signal)}
 analyze(world:string,revision:number,signal?:AbortSignal){return this.repository.mutate(world,'',{expectedDraftRevision:revision},signal)}
 decide(world:string,analysis:Analysis,candidate:Candidate,action:ReviewAction,edited:Candidate|null,comment:string,signal?:AbortSignal){
  if(analysis.freshness!=='current'||analysis.executionStatus!=='completed')throw new Error('원본이 변경되었거나 분석이 완료되지 않았어요. 상태를 확인하고 재분석해 주세요.')
  const current=currentCandidate(analysis,candidate)
  return this.repository.mutate(world,`/${analysis.analysisId}/candidates/${current.id}/decisions`,{expectedDecisionSequence:current.sequence,action,editedCandidate:action==='edit'&&edited?{...edited,localRef:candidate.localRef,provenance:'author_revision',evidence:[]}:null,comment},signal)
 }
 apply(world:string,analysis:Analysis,ids:string[],signal?:AbortSignal){
  if(analysis.freshness!=='current'||analysis.executionStatus!=='completed')throw new Error('원본이 변경되었어요. 재분석 후 반영해 주세요.')
  const selected=analysis.output?.candidates.map(c=>currentCandidate(analysis,c)).filter(c=>ids.includes(c.id))??[]
  if(!selected.length||selected.length!==new Set(ids).size||selected.some(c=>c.state!=='approved'))throw new Error('최신 승인 후보만 선택해 주세요.')
  return this.repository.mutate(world,`/${analysis.analysisId}/applications`,{expectedDraftRevision:analysis.basis.draftRevision,candidates:selected.map(c=>({candidateId:c.id,decisionSequence:c.sequence}))},signal)
 }
}
