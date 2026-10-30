import type { AwilixContainer } from 'awilix/browser'

import type { CoreApiHealth } from '../../data/api/coreApiHealth'
import type { MockDb } from '../../data/mock/InMemoryRepositories'
import type { InquiryRepository } from '../../domain/repositories/InquiryRepository'
import type { ChatRepository } from '../../domain/repositories/ChatRepository'
import type { CreditRepository } from '../../domain/repositories/CreditRepository'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { WorldRepository } from '../../domain/repositories/WorldRepository'
import type { AccountUseCase } from '../../domain/usecases/AccountUseCase'
import type { ChatUseCase } from '../../domain/usecases/ChatUseCase'
import type { CreditUseCase } from '../../domain/usecases/CreditUseCase'
import type { FeedbackUseCase } from '../../domain/usecases/FeedbackUseCase'
import type { ForkUseCase } from '../../domain/usecases/ForkUseCase'
import type { InboxUseCase } from '../../domain/usecases/InboxUseCase'
import type { LibraryUseCase } from '../../domain/usecases/LibraryUseCase'
import type { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import type { StudioUseCase } from '../../domain/usecases/StudioUseCase'
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
  worldRepository: WorldRepository
  creditRepository: CreditRepository
  chatRepository: ChatRepository
  inquiryRepository: InquiryRepository
  accountUseCase: AccountUseCase
  chatUseCase: ChatUseCase
  inboxUseCase: InboxUseCase
  libraryUseCase: LibraryUseCase
  creditUseCase: CreditUseCase
  readingUseCase: ReadingUseCase
  feedbackUseCase: FeedbackUseCase
  forkUseCase: ForkUseCase
  studioUseCase: StudioUseCase
  shellUseCase: ShellUseCase
}

export type AppContainer = AwilixContainer<AppCradle>
