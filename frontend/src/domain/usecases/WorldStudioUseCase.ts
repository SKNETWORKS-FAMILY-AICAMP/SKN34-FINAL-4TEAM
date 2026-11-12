import {characterDocIssues} from '../entities/characterDocs'
import {invalidReveal,REVEAL_EPISODE_ERROR,worldCoverError,type StudioWorld,type WorldPublicationInput} from '../entities/studioWorld'
import type {WorldStudioRepository} from '../repositories/WorldStudioRepository'
export class WorldStudioUseCase {
 private readonly repository:WorldStudioRepository
 constructor(repository:WorldStudioRepository){this.repository=repository}
 get supportsRevisions(){return !!this.repository.confirm}
 get supportsCover(){return !!this.repository.setCover}
 revisions(id:string,signal?:AbortSignal){if(!this.repository.revisions)throw new Error('데모에서는 확정 버전을 지원하지 않습니다.');return this.repository.revisions(id,signal)}
 revision(id:string,revision:string,signal?:AbortSignal){if(!this.repository.revision)throw new Error('데모에서는 확정 버전을 지원하지 않습니다.');return this.repository.revision(id,revision,signal)}
 confirm(id:string,expected:number,signal?:AbortSignal){if(!this.repository.confirm)throw new Error('데모에서는 확정 버전을 지원하지 않습니다.');return this.repository.confirm(id,expected,signal)}
 pendingConfirmation(id:string){return this.repository.pendingConfirmation?.(id)??null}
 acknowledgeConfirmation(id:string){this.repository.acknowledgeConfirmation?.(id)}
 list(signal?:AbortSignal){return this.repository.listStudio(signal)}
 read(id:string,signal?:AbortSignal){return this.repository.read(id,signal)}
 setPublication(id:string,publication:WorldPublicationInput,signal?:AbortSignal){return this.repository.setPublication(id,publication,signal)}
 /** 표지를 올리거나 바꾼다. 형식·크기는 보내기 전에 거른다. */
 setCover(id:string,file:File,signal?:AbortSignal){
  if(!this.repository.setCover)throw new Error('데모에서는 표지 업로드를 지원하지 않습니다.')
  const error=worldCoverError(file)
  if(error)throw new Error(error)
  return this.repository.setCover(id,file,signal)
 }
 removeCover(id:string,signal?:AbortSignal){if(!this.repository.removeCover)throw new Error('데모에서는 표지 삭제를 지원하지 않습니다.');return this.repository.removeCover(id,signal)}
 cover(id:string,signal?:AbortSignal){if(!this.repository.readCover)throw new Error('데모에서는 표지를 읽지 않습니다.');return this.repository.readCover(id,signal)}
 async create(name:string,description:string,signal?:AbortSignal){
  if(!name.trim()||name.length>100||description.length>20000)throw new Error('세계관 이름과 설명의 길이를 확인해 주세요.')
  return this.repository.create(name,description,signal)
 }
 async save(world:StudioWorld,signal?:AbortSignal){
  if(!world.name.trim()||world.name.length>100||world.description.length>20000)throw new Error('세계관 이름과 설명의 길이를 확인해 주세요.')
  // 인물 문서(본문인 IDENTITY.md 포함)의 문제는 저장 전 확인과 같은 문구로 알린다. 그래서 본문 길이를 함께 보는 아래 검사보다 먼저 본다.
  const docIssue=world.settings.flatMap(characterDocIssues)[0]
  if(docIssue)throw new Error(docIssue)
  if(world.settings.some(s=>!s.item.title.trim()||s.item.title.length>200||s.item.text.length>3000))throw new Error('설정 이름과 설명의 길이를 확인해 주세요.')
  if(world.settings.some(s=>s.item.kind==='relation'&&(!s.item.subjectId?.trim()||!s.item.targetId?.trim())))throw new Error('관계 주체와 대상을 선택해 주세요.')
  if(world.settings.some(invalidReveal))throw new Error(REVEAL_EPISODE_ERROR)
  return this.repository.saveStudio(world,signal)
 }
}
