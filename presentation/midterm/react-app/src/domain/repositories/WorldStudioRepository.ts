import type { SettingItem, StudioWorld } from '../entities/studioWorld'
import type { WorldRepository } from './WorldRepository'

export interface WorldStudioRepository extends WorldRepository {
 connect():Promise<void>
 capabilities():Promise<{aiEnabled:boolean}>
 listStudio(signal?:AbortSignal):Promise<StudioWorld[]>
 read(id:string,signal?:AbortSignal):Promise<StudioWorld>
 create(name:string,description:string):Promise<StudioWorld>
 saveStudio(world:StudioWorld):Promise<StudioWorld>
 analyze(world:StudioWorld):Promise<StudioWorld>
 approve(world:StudioWorld,ids:string[],edits:SettingItem[]):Promise<StudioWorld>
}
