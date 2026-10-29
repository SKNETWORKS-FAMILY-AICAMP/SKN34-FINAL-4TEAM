import type { AwilixContainer } from 'awilix/browser'

import type { CoreApiHealth } from '../../data/api/coreApiHealth'
import type { MockDb } from '../../data/mock/InMemoryRepositories'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { FeedbackUseCase } from '../../domain/usecases/FeedbackUseCase'
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
  feedbackRepository: FeedbackRepository
  readingUseCase: ReadingUseCase
  feedbackUseCase: FeedbackUseCase
  shellUseCase: ShellUseCase
}

export type AppContainer = AwilixContainer<AppCradle>
