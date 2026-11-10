import type {EpisodeRepository} from '../repositories/EpisodeRepository'
import type { Draft, SettingInput, WorkRegistration } from '../entities/content'
import { toKstDateTimeInput, type PublicationScheduleRevision } from '../entities/publicationSchedule'

export class EpisodeUseCase {
  private readonly repository: EpisodeRepository
  constructor(repository: EpisodeRepository) { this.repository = repository }
  orderScope(id:string,number:number,signal?:AbortSignal) {return this.repository.orderScope(id,number,signal)}
  deleteDraft(id:string,number:number,revision:number,signal?:AbortSignal) {return this.repository.deleteDraft(id,number,revision,signal)}
  deleteEpisode(id:string,number:number,revision:number,signal?:AbortSignal) {return this.repository.deleteEpisode(id,number,revision,signal)}
  writingList(id:string,signal?:AbortSignal) {return this.repository.writingList(id,signal)}
  createEpisode(id:string,title:string,signal?:AbortSignal) {
    if(!title.trim() || title.length>120) return Promise.reject(new Error('회차 제목을 120자 이내로 입력해 주세요.'))
    return this.repository.createEpisode(id,title.trim(),signal)
  }
  writeEpisode(id:string,number:number,draft:Draft,version:boolean,signal?:AbortSignal) {
    if(!draft.title.trim() || draft.title.length>120 || draft.body.length>40000) return Promise.reject(new Error('제목은 120자, 원고는 40,000자 이내로 작성해 주세요.'))
    if((draft.authorNote?.length ?? 0)>2000) return Promise.reject(new Error('작가의 말은 2,000자 이내로 작성해 주세요.'))
    return this.repository.writeEpisode(id,number,draft,version,signal)
  }
  restoreEpisode(id:string,number:number,revision:number,versionId:string,signal?:AbortSignal) {return this.repository.restoreEpisode(id,number,revision,versionId,signal)}
  publishEpisode(id:string,number:number,revision:number,versionId:string,rights:boolean,signal?:AbortSignal) {
    if(!versionId || !rights) return Promise.reject(new Error('저장 버전 선택과 공개 권리 확인이 필요해요.'))
    return this.repository.publishEpisode(id,number,revision,versionId,rights,signal)
  }
  publicationSchedules(id: string, number: number, signal?: AbortSignal) {
    return this.repository.publicationSchedules(id, number, signal)
  }
  async savePublicationSchedule(id: string, number: number, versionId: string, kst: string, rightsConfirmed: boolean, target?: PublicationScheduleRevision, signal?: AbortSignal) {
    if (!versionId || !rightsConfirmed) throw new Error('저장 버전 선택과 공개 권리 확인이 필요해요.')
    const timestamp = Date.parse(kst + '+09:00')
    if (!Number.isFinite(timestamp) || toKstDateTimeInput(new Date(timestamp).toISOString()) !== kst) {
      throw new Error('한국 시각으로 예약 날짜와 시간을 확인해 주세요.')
    }
    if (timestamp <= Date.now()) throw new Error('예약 시각은 미래로 지정해 주세요.')
    return this.repository.savePublicationSchedule(id, number, { versionId, scheduledAt: new Date(timestamp).toISOString(), rightsConfirmed }, target, signal)
  }
  cancelPublicationSchedule(id: string, number: number, target: PublicationScheduleRevision, signal?: AbortSignal) {
    return this.repository.cancelPublicationSchedule(id, number, target, signal)
  }
  publicList(signal?: AbortSignal) { return this.repository.publicList(signal) }
  list(signal?: AbortSignal) { return this.repository.list(signal) }
  create(title: string, summary: string, signal?: AbortSignal, registration?: WorkRegistration) {
    if (!title.trim()) return Promise.reject(new Error('작품 제목을 입력해 주세요.'))
    if (registration) {
      if (registration.genres.length<1 || registration.genres.length>2) return Promise.reject(new Error('장르는 1~2개를 선택해 주세요.'))
      if (registration.hashtags.length>10) return Promise.reject(new Error('해시태그는 10개까지 입력할 수 있어요.'))
      if (!registration.rightsConfirmed) return Promise.reject(new Error('작품 권리 확인이 필요해요.'))
    }
    return this.repository.create(title.trim(),summary.trim(),signal,registration)
  }
  updateWork(id: string, title: string, summary: string, revision: number, signal?: AbortSignal) {
    if (!title.trim() || title.length>120 || summary.length>2000) return Promise.reject(new Error('작품 제목은 120자, 소개는 2,000자 이내로 입력해 주세요.'))
    return this.repository.updateWork(id,title.trim(),summary.trim(),revision,signal)
  }
  stopForkPublication(id: string, signal?: AbortSignal) { return this.repository.stopForkPublication(id,signal) }
  deleteWork(id: string, signal?: AbortSignal) { return this.repository.deleteWork(id,signal) }
  save(id: string, draft: Draft) { return this.repository.save(id,draft) }
  publish(id: string, draft: Draft, rights: boolean, allowFork: boolean, allowForkPublication = false, versionId?: string) {
    if (!draft.body.trim()) return Promise.reject(new Error('원고를 먼저 작성해 주세요.'))
    if (!rights) return Promise.reject(new Error('공개 권리를 확인해 주세요.'))
    return this.repository.publish(id,draft.revision,rights,allowFork,allowForkPublication,versionId)
  }
  history(id: string,signal?:AbortSignal) { return this.repository.history(id,signal) }
  setPublicationVisibility(id:string,number:number,revision:number,visible:boolean,rightsConfirmed:boolean,signal?:AbortSignal) {
    if(visible&&!rightsConfirmed) return Promise.reject(new Error('공개 권리를 확인해 주세요.'))
    return this.repository.setPublicationVisibility(id,number,revision,visible,rightsConfirmed,signal)
  }
  policy(id: string, revision: number, allowFork: boolean, allowForkPublication: boolean) { return this.repository.policy(id,revision,allowFork,allowForkPublication) }
  fork(id: string, episode: number, title: string, direction: string) { return this.repository.fork(id,episode,title,direction) }
  propose(id: string, draft: Draft, prompt: string, consent: boolean, signal?: AbortSignal, episode?:number, character='') {
    if (!consent) return Promise.reject(new Error('OpenAI 전송 및 비용에 동의해 주세요.'))
    return this.repository.propose(id,draft.revision,prompt,consent,signal,episode,character)
  }
  accept(id: string, pid: string, revision: number) { return this.repository.accept(id,pid,revision) }
  world(id:string,signal?:AbortSignal) {return this.repository.world(id,signal)}
  createWorldCheckpoint(id: string, signal?: AbortSignal) { return this.repository.createWorldCheckpoint(id, signal) }
  worldCheckpoints(id: string, signal?: AbortSignal) { return this.repository.worldCheckpoints(id, signal) }
  worldCheckpoint(id: string, checkpointId: string, signal?: AbortSignal) { return this.repository.worldCheckpoint(id, checkpointId, signal) }
  saveSetting(id:string,sid:string,revision:number,value:SettingInput,sourceToken:string) {return this.repository.saveSetting(id,sid,revision,value,sourceToken)}
  commitSetting(id:string,sid:string,revision:number) {return this.repository.commitSetting(id,sid,revision)}
  revertSetting(id:string,sid:string,revision:number,versionId:string,signal?:AbortSignal) {return this.repository.revertSetting(id,sid,revision,versionId,signal)}
  decideChange(id:string,revision:number,changeId:string,decision:'apply'|'reject') {return this.repository.decideChange(id,revision,changeId,decision)}
  context(id:string,episode:number,query:string,character:string,publicView=false) {return this.repository.context(id,episode,query,character,publicView)}
  episodeWorldBasis(id: string, number: number, signal?: AbortSignal) {
    return this.repository.episodeWorldBasis(id, number, signal)
  }
  chooseEpisodeWorldBasis(id: string, number: number, choice: import('../entities/episodeWorldBasis').EpisodeWorldBasisChoice, signal?: AbortSignal) {
    return this.repository.chooseEpisodeWorldBasis(id, number, choice, signal)
  }
  worldBasisVersions(worldId: string, signal?: AbortSignal) {
    return this.repository.worldBasisVersions(worldId, signal)
  }
  worldBasisCards(worldId: string, revisionId: string, signal?: AbortSignal) {
    return this.repository.worldBasisCards(worldId, revisionId, signal)
  }
  confirmWorldBasisVersion(worldId: string, expectedDraftRevision: number, key: string, signal?: AbortSignal) {
    return this.repository.confirmWorldBasisVersion(worldId, expectedDraftRevision, key, signal)
  }
}
