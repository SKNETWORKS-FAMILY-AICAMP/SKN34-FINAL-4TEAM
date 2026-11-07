import type {StudioWorld} from '../../domain/entities/studioWorld'
import type {WorldStudioRepository} from '../../domain/repositories/WorldStudioRepository'
/** 페이지를 새로 고치면 사라지는 데모. 서버 인증·저장과 연결하지 않습니다. */
export class InMemoryWorldStudioRepository implements WorldStudioRepository {
 private worlds=new Map<string,StudioWorld>()
 constructor(seed:StudioWorld[]=[]){for(const world of seed)this.worlds.set(world.id,structuredClone(world))}
 async listStudio(){return structuredClone([...this.worlds.values()])}
 async read(id:string){const world=this.worlds.get(id);if(!world)throw new Error('데모 세계관을 찾을 수 없습니다. 새로고침하면 데이터가 초기화됩니다.');return structuredClone(world)}
 async create(name:string,description:string){const world:StudioWorld={id:crypto.randomUUID(),name,description,version:1,settings:[],analysis:null};this.worlds.set(world.id,structuredClone(world));return world}
 async saveStudio(world:StudioWorld){
  const previous=await this.read(world.id)
  if(previous.version!==world.version)throw new Error('다른 변경이 저장되어 있습니다. 세계관을 다시 열어 주세요.')
  const saved=structuredClone({...world,version:world.version+1});this.worlds.set(saved.id,saved);return structuredClone(saved)
 }
}
