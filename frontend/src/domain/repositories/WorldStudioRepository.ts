import type {StudioWorld} from '../entities/studioWorld'
import type {WorldRepository} from './WorldRepository'
export interface WorldStudioRepository extends WorldRepository {
 connect():Promise<void>
 listStudio(signal?:AbortSignal):Promise<StudioWorld[]>
 read(id:string,signal?:AbortSignal):Promise<StudioWorld>
 create(name:string,description:string):Promise<StudioWorld>
 saveStudio(world:StudioWorld):Promise<StudioWorld>
}
