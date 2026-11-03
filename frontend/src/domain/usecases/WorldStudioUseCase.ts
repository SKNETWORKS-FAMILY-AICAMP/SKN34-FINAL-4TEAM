import type { StudioWorld } from '../entities/studioWorld'
import type { WorldStudioRepository } from '../repositories/WorldStudioRepository'

export class WorldStudioUseCase {
 private readonly repository:WorldStudioRepository
 constructor(repository:WorldStudioRepository) {this.repository=repository}
 connect() {return this.repository.connect()}
 list(signal?:AbortSignal) {return this.repository.listStudio(signal)}
 read(id:string,signal?:AbortSignal) {return this.repository.read(id,signal)}
 create(name:string,description:string) {return this.repository.create(name,description)}
 save(w:StudioWorld) {return this.repository.saveStudio(w)}
}
