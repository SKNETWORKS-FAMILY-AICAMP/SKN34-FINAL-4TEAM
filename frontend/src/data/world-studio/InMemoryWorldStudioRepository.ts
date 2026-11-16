import {storedCharacterDocs} from '../../domain/entities/characterDocs'
import type {StudioSetting,StudioWorld,WorldPublication,WorldPublicationInput} from '../../domain/entities/studioWorld'
import type {WorldStudioRepository} from '../../domain/repositories/WorldStudioRepository'
/** 페이지를 새로 고치면 사라지는 데모. 서버 인증·저장과 연결하지 않습니다. */
export class InMemoryWorldStudioRepository implements WorldStudioRepository {
 private worlds=new Map<string,StudioWorld>()
 constructor(seed:StudioWorld[]=[]){for(const world of seed)this.worlds.set(world.id,structuredClone(world))}
 async listStudio(){return structuredClone([...this.worlds.values()])}
 async read(id:string){const world=this.worlds.get(id);if(!world)throw new Error('데모 세계관을 찾을 수 없습니다. 새로고침하면 데이터가 초기화됩니다.');return structuredClone(world)}
 async create(name:string,description:string){const world:StudioWorld={id:crypto.randomUUID(),name,description,version:0,visibility:'private',genre:null,settings:[],analysis:null};this.worlds.set(world.id,structuredClone(world));return world} // 서버처럼 초안 버전 0에서 시작해 첫 저장이 1이다
 async saveStudio(world:StudioWorld){
  const previous=await this.read(world.id)
  if(previous.version!==world.version)throw new Error('다른 변경이 저장되어 있습니다. 세계관을 다시 열어 주세요.')
  // 인물 문서는 서버 저장과 같은 규칙으로 보관한다: 인물 카드에 문서가 하나라도 있을 때만 남긴다.
  const settings=world.settings.map((setting):StudioSetting=>{const {characterDocs:_,...row}=setting,docs=storedCharacterDocs(setting);return docs?{...row,characterDocs:docs}:row})
  const saved=structuredClone({...world,settings,version:world.version+1,visibility:previous.visibility,genre:previous.genre}) // 공개 설정은 초안 저장과 별개라 편집본의 값이 아니라 저장된 값을 유지한다
  this.worlds.set(saved.id,saved);return structuredClone(saved)
 }
 async setPublication(id:string,{visibility,genre}:WorldPublicationInput):Promise<WorldPublication>{
  const world=await this.read(id)
  this.worlds.set(id,structuredClone({...world,visibility,genre}))
  // ponytail: 공개 시각은 화면이 읽지 않아 호출마다 새로 찍는다(서버는 처음 공개한 시각을 유지). 데모에는 확정 버전이 없어 한 번이라도 저장했으면(버전 1 이상) 목록에 나오는 것으로 본다(서버는 확정 버전이 있어야 한다).
  return {worldId:id,visibility,genre,publishedAt:visibility==='public'?new Date().toISOString():null,listed:visibility==='public'&&world.version>0}
 }
}
