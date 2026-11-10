import type {AiRunRepository,RunInput,ChangeProposal} from '../entities/aiRun'

export class AiRunUseCase {
  private readonly repository:AiRunRepository
  constructor(repository:AiRunRepository){this.repository=repository}
  session(){return this.repository.session()}
  metadata(work:string,signal:AbortSignal){return this.repository.metadata(work,signal)}
  create(work:string,input:RunInput,key:string,signal:AbortSignal){return this.repository.create(work,input,key,signal)}
  status(work:string,id:string,signal:AbortSignal){return this.repository.status(work,id,signal)}
  details(work:string,id:string,signal:AbortSignal){return this.repository.details(work,id,signal)}
  cancel(work:string,id:string,signal:AbortSignal){return this.repository.cancel(work,id,signal)}
  proposal(work:string,id:string,signal:AbortSignal){return this.repository.proposal(work,id,signal)}
  decide(work:string,p:ChangeProposal,action:'approve'|'reject'|'revise',key:string,signal:AbortSignal){return this.repository.decide(work,p,action,key,signal)}
  watch(...args:Parameters<AiRunRepository['watch']>){return this.repository.watch(...args)}
}
