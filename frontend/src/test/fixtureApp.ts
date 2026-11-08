import { vi } from 'vitest'

/** Legacy demo integration tests opt in explicitly; production DI stays unseeded and HTTP-backed. */
vi.mock('../app/appContainer',async()=>{
  const {createAppContainer}=await import('../app/di/container')
  const {createFixtureDb}=await import('../data/mock/fixtureDb')
  const {InMemoryWorkRepository}=await import('../data/mock/InMemoryRepositories')
  const {asValue}=await import('awilix/browser')
  const db=createFixtureDb(),appContainer=createAppContainer()
  appContainer.register({mockDb:asValue(db),workRepository:asValue(new InMemoryWorkRepository(db))})
  return {appContainer}
})
