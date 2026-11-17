import type {ManuscriptBuildRepository} from '../repositories/ManuscriptBuildRepository'
export class ManuscriptBuildUseCase {
 private readonly repository:ManuscriptBuildRepository
 constructor(repository:ManuscriptBuildRepository){this.repository=repository}
 read(workId:string,signal?:AbortSignal){return this.repository.read(workId,signal)}
 start(workId:string,worldId:string|null|undefined,consent:boolean,signal?:AbortSignal){
  if(!consent)throw new Error('저장된 원고의 비공개 세계관 초안 생성을 확인해 주세요.')
  return this.repository.start(workId,worldId,signal)
 }
 resume(workId:string,signal?:AbortSignal){return this.repository.resume(workId,signal)}
}
