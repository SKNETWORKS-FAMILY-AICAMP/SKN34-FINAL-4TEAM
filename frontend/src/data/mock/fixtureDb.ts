import { createMockDb } from './InMemoryRepositories'
import { SEED_COMMENTS, seedAdmin, seedWorks, seedWorlds } from './seed'

/** 테스트에서만 명시적으로 사용한다. production DI는 이 모듈을 import하지 않는다. */
export function createFixtureDb() {
  const db=createMockDb()
  db.works=seedWorks()
  db.worlds=seedWorlds()
  db.admin=seedAdmin()
  db.seedComments=structuredClone(SEED_COMMENTS)
  db.progress={last:{guunmong:2,starlight:1},read:{guunmong:[1,2],starlight:[1]},seen:{},liked:{}}
  return db
}
