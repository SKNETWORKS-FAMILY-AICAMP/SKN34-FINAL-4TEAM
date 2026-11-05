import type {StudioWorld} from '../entities/studioWorld'
import type {WorldStudioRepository} from '../repositories/WorldStudioRepository'
export class WorldStudioUseCase {
 private readonly repository:WorldStudioRepository
 constructor(repository:WorldStudioRepository){this.repository=repository}
 list(signal?:AbortSignal){return this.repository.listStudio(signal)}
 read(id:string,signal?:AbortSignal){return this.repository.read(id,signal)}
 async create(name:string,description:string,signal?:AbortSignal){
  if(!name.trim()||name.length>100||description.length>20000)throw new Error('세계관 이름과 설명의 길이를 확인해 주세요.')
  return this.repository.create(name,description,signal)
 }
 async save(world:StudioWorld,signal?:AbortSignal){
  if(!world.name.trim()||world.name.length>100||world.description.length>20000)throw new Error('세계관 이름과 설명의 길이를 확인해 주세요.')
  if(world.settings.some(s=>!s.item.title.trim()||s.item.title.length>200||s.item.text.length>3000))throw new Error('설정 이름과 설명의 길이를 확인해 주세요.')
  if(world.settings.some(s=>s.item.kind==='relation'&&(!s.item.subjectId?.trim()||!s.item.targetId?.trim())))throw new Error('관계 주체와 대상을 선택해 주세요.')
  return this.repository.saveStudio(world,signal)
 }
}
