import type {Analysis,MutationResult,Receipt} from '../entities/initialWorld'
export interface InitialWorldRepository {
 list(world:string,signal?:AbortSignal):Promise<Analysis[]>
 read(world:string,id:string,signal?:AbortSignal):Promise<Analysis>
 receipt(world:string,analysis:string,id:string,signal?:AbortSignal):Promise<Receipt>
 acknowledge(world:string):void
 pending(world:string):{path:string;body:Record<string,unknown>}|null
 mutate(world:string,path:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<MutationResult>
 resume(world:string,signal?:AbortSignal):Promise<MutationResult>
}
