import type {StudioWorld} from '../entities/studioWorld'
export interface WorldStudioRepository {
 connect():Promise<void>
 listStudio(signal?:AbortSignal):Promise<StudioWorld[]>
 read(id:string,signal?:AbortSignal):Promise<StudioWorld>
 create(name:string,description:string):Promise<StudioWorld>
 saveStudio(world:StudioWorld):Promise<StudioWorld>
}
