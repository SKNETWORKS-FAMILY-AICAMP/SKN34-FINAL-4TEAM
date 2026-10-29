import type { AwilixContainer } from 'awilix/browser'

import type { CoreApiHealth } from '../../data/api/coreApiHealth'
import type { MockDb } from '../../data/mock/InMemoryRepositories'
import type { NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import type { ShellUseCase } from '../../domain/usecases/ShellUseCase'

export type FetchCoreApiHealth = (signal?: AbortSignal) => Promise<CoreApiHealth>

export type AppCradle = {
  fetchCoreApiHealth: FetchCoreApiHealth
  fetchAiServiceHealth: FetchCoreApiHealth
  mockDb: MockDb
  workRepository: WorkRepository
  readingRepository: ReadingRepository
  notificationRepository: NotificationRepository
  readingUseCase: ReadingUseCase
  shellUseCase: ShellUseCase
}

export type AppContainer = AwilixContainer<AppCradle>
