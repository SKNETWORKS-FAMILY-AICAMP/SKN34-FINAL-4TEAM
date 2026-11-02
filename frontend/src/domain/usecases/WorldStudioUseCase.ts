import type { SettingItem, StudioWorld } from '../entities/studioWorld'
import type { WorldStudioRepository } from '../repositories/WorldStudioRepository'

export class WorldStudioUseCase {
 private readonly repository:WorldStudioRepository
 constructor(repository:WorldStudioRepository) {this.repository=repository}
 connect() {return this.repository.connect()}
 capabilities() {return this.repository.capabilities()}
 list(signal?:AbortSignal) {return this.repository.listStudio(signal)}
 read(id:string,signal?:AbortSignal) {return this.repository.read(id,signal)}
 create(name:string,description:string) {return this.repository.create(name,description)}
 save(w:StudioWorld) {return this.repository.saveStudio(w)}
 analyze(w:StudioWorld) {return this.repository.analyze(w)}
 approve(w:StudioWorld,ids:string[],edits:SettingItem[]) {return this.repository.approve(w,ids,edits)}
}
