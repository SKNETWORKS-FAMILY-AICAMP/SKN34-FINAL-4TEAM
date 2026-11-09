import { asValue } from 'awilix/browser'

import { createAppContainer } from '../app/di/container'
import { createFixtureDb } from '../data/mock/fixtureDb'
import { InMemoryEventRepository } from '../data/mock/InMemoryEventRepository'
import { InMemoryWorkRepository } from '../data/mock/InMemoryRepositories'

/** 시드 작품과 메모리 Work·운영 이벤트 저장소를 명시 연결한 격리 컨테이너. 테스트 전용이며 production DI는 이를 쓰지 않는다. */
export function createFixtureContainer() {
  const db = createFixtureDb(), container = createAppContainer()
  container.register({ mockDb: asValue(db), workRepository: asValue(new InMemoryWorkRepository(db)), eventRepository: asValue(new InMemoryEventRepository()) })
  return container
}
