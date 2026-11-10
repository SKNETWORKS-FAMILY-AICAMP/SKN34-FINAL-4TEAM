import type {WorkRegistration,WritingEpisode,Draft,Work,Proposal,History,World,SettingInput,StoryContext} from '../entities/content'

export interface EpisodeRepository {
  orderScope(id:string,number:number,signal?:AbortSignal):Promise<import('../entities/content').EpisodeOrderScope>
  deleteDraft(id:string,number:number,revision:number,signal?:AbortSignal):Promise<void>
  deleteEpisode(id:string,number:number,revision:number,signal?:AbortSignal):Promise<void>
  writingList(id:string,signal?:AbortSignal):Promise<WritingEpisode[]>
  createEpisode(id:string,title:string,signal?:AbortSignal):Promise<WritingEpisode>
  writeEpisode(id:string,number:number,draft:Draft,version:boolean,signal?:AbortSignal):Promise<WritingEpisode>
  restoreEpisode(id:string,number:number,revision:number,versionId:string,signal?:AbortSignal):Promise<WritingEpisode>
  publishEpisode(id:string,number:number,revision:number,versionId:string,rights:boolean,signal?:AbortSignal):Promise<WritingEpisode>
  publicList(signal?: AbortSignal): Promise<Work[]>
  list(signal?: AbortSignal): Promise<Work[]>
  create(title: string, summary: string, signal?: AbortSignal, registration?: WorkRegistration): Promise<Work>
  updateWork(id: string, title: string, summary: string, revision: number, signal?: AbortSignal): Promise<Work>
  deleteWork(id: string, signal?: AbortSignal): Promise<void>
  save(id: string, draft: Draft): Promise<Draft>
  publish(id: string, revision: number, rightsConfirmed: boolean, allowFork: boolean, allowForkPublication?: boolean, versionId?: string): Promise<Work>
  history(id: string,signal?:AbortSignal): Promise<History>
  setPublicationVisibility(id:string,number:number,revision:number,visible:boolean,rightsConfirmed:boolean,signal?:AbortSignal):Promise<WritingEpisode>
  policy(id: string, revision: number, allowFork: boolean, allowForkPublication: boolean): Promise<Work>
  fork(id: string, episode: number, title: string, direction: string): Promise<Work>
  propose(id: string, revision: number, prompt: string, consent: boolean, signal?: AbortSignal, episode?:number, character?:string): Promise<Proposal>
  accept(id: string, pid: string, revision: number): Promise<Draft>
  world(id:string,signal?:AbortSignal):Promise<World>
  saveSetting(id:string,sid:string,revision:number,setting:SettingInput,sourceToken:string):Promise<World>
  commitSetting(id:string,sid:string,revision:number):Promise<World>
  revertSetting(id:string,sid:string,revision:number,versionId:string,signal?:AbortSignal):Promise<World>
  decideChange(id:string,revision:number,changeId:string,decision:'apply'|'reject'):Promise<World>
  context(id:string,episode:number,query:string,character:string,publicView:boolean):Promise<StoryContext>
}
