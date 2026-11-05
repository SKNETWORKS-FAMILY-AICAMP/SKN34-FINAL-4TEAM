import type {StudioWorld} from '../entities/studioWorld'
export interface WorldStudioRepository {
 listStudio(signal?:AbortSignal):Promise<StudioWorld[]>
 read(id:string,signal?:AbortSignal):Promise<StudioWorld>
 create(name:string,description:string,signal?:AbortSignal):Promise<StudioWorld>
 saveStudio(world:StudioWorld,signal?:AbortSignal):Promise<StudioWorld>
}
