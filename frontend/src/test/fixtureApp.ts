import { vi } from 'vitest'

/** Legacy demo integration tests opt in explicitly; production DI stays unseeded and HTTP-backed. */
vi.mock('../app/appContainer', async () => ({ appContainer: (await import('./fixtureContainer')).createFixtureContainer() }))
