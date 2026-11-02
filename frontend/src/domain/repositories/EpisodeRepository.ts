import type {Draft,Work,Proposal,History,World,SettingInput,StoryContext} from '../entities/content'

export interface EpisodeRepository {
  publicList(signal?: AbortSignal): Promise<Work[]>
  list(signal?: AbortSignal): Promise<Work[]>
  create(title: string, summary: string): Promise<Work>
  save(id: string, draft: Draft): Promise<Draft>
  publish(id: string, revision: number, rightsConfirmed: boolean, allowFork: boolean, allowForkPublication?: boolean, versionId?: string): Promise<Work>
  history(id: string): Promise<History>
  policy(id: string, revision: number, allowFork: boolean, allowForkPublication: boolean): Promise<Work>
  fork(id: string, episode: number, title: string, direction: string): Promise<Work>
  propose(id: string, revision: number, prompt: string, consent: boolean, signal?: AbortSignal, episode?:number, character?:string): Promise<Proposal>
  accept(id: string, pid: string, revision: number): Promise<Draft>
  world(id:string):Promise<World>
  saveSetting(id:string,sid:string,revision:number,setting:SettingInput,sourceToken:string):Promise<World>
  commitSetting(id:string,sid:string,revision:number):Promise<World>
  revertSetting(id:string,sid:string,revision:number,versionId:string):Promise<World>
  decideChange(id:string,revision:number,changeId:string,decision:'apply'|'reject'):Promise<World>
  context(id:string,episode:number,query:string,character:string,publicView:boolean):Promise<StoryContext>
}
