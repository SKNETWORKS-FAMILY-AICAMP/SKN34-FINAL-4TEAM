import {characterDocIssues} from '../entities/characterDocs'
import {invalidRelationEpisode,invalidReveal,RELATION_EPISODE_ERROR,REVEAL_EPISODE_ERROR,worldCoverError,type StudioWorld,type WorldPublicationInput} from '../entities/studioWorld'
import type {WorldStudioRepository} from '../repositories/WorldStudioRepository'
export class WorldStudioUseCase {
 private readonly repository:WorldStudioRepository
 constructor(repository:WorldStudioRepository){this.repository=repository}
 get supportsRevisions(){return !!this.repository.confirm}
 get supportsCover(){return !!this.repository.setCover}
 /** 관계를 회차 시점으로 읽고 쓰는 저장소인지(DEC-51). 메모리 데모는 아니다. */
 get supportsRelationEpisodes(){return !!this.repository.relationEpisodes}
 /** 회차는 관계의 시점이다. 1 이상의 정수만 받고, 회차별 관계를 모르는 저장소(데모)에는 보내지 않는다. */
 private checkEpisode(episode:number){
  if(invalidRelationEpisode(episode))throw new Error(RELATION_EPISODE_ERROR)
  if(!this.supportsRelationEpisodes)throw new Error('데모에서는 회차별 관계를 지원하지 않습니다.')
 }
 revisions(id:string,signal?:AbortSignal){if(!this.repository.revisions)throw new Error('데모에서는 확정 버전을 지원하지 않습니다.');return this.repository.revisions(id,signal)}
 revision(id:string,revision:string,signal?:AbortSignal){if(!this.repository.revision)throw new Error('데모에서는 확정 버전을 지원하지 않습니다.');return this.repository.revision(id,revision,signal)}
 confirm(id:string,expected:number,signal?:AbortSignal){if(!this.repository.confirm)throw new Error('데모에서는 확정 버전을 지원하지 않습니다.');return this.repository.confirm(id,expected,signal)}
 pendingConfirmation(id:string){return this.repository.pendingConfirmation?.(id)??null}
 acknowledgeConfirmation(id:string){this.repository.acknowledgeConfirmation?.(id)}
 list(signal?:AbortSignal){return this.repository.listStudio(signal)}
 /** `episode`를 고르지 않으면(최신 회차) 기존 호출 그대로 읽는다. */
 async read(id:string,signal?:AbortSignal,episode?:number){
  if(episode===undefined)return this.repository.read(id,signal)
  this.checkEpisode(episode)
  return this.repository.read(id,signal,episode)
 }
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
 /** 받은 관계 전체를 `episode`(생략하면 최신 회차) 시점 값으로 저장한다. */
 async save(world:StudioWorld,signal?:AbortSignal,episode?:number){
  if(episode!==undefined)this.checkEpisode(episode)
  if(!world.name.trim()||world.name.length>100||world.description.length>20000)throw new Error('세계관 이름과 설명의 길이를 확인해 주세요.')
  // 인물 문서(본문인 IDENTITY.md 포함)의 문제는 저장 전 확인과 같은 문구로 알린다. 그래서 본문 길이를 함께 보는 아래 검사보다 먼저 본다.
  const docIssue=world.settings.flatMap(characterDocIssues)[0]
  if(docIssue)throw new Error(docIssue)
  if(world.settings.some(s=>!s.item.title.trim()||s.item.title.length>200||s.item.text.length>3000))throw new Error('설정 이름과 설명의 길이를 확인해 주세요.')
  if(world.settings.some(s=>s.item.kind==='relation'&&(!s.item.subjectId?.trim()||!s.item.targetId?.trim())))throw new Error('관계 주체와 대상을 선택해 주세요.')
  if(world.settings.some(invalidReveal))throw new Error(REVEAL_EPISODE_ERROR)
  return episode===undefined?this.repository.saveStudio(world,signal):this.repository.saveStudio(world,signal,episode)
 }
}
