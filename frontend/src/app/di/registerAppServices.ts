import { asFunction, asValue } from 'awilix/browser'

import {
  createMockDb,
  InMemoryChatRepository,
  InMemoryCreditRepository,
  InMemoryFeedbackRepository,
  InMemoryInquiryRepository,
  InMemoryNotificationRepository,
  InMemoryReadingRepository,
  InMemoryWorkRepository,
  InMemoryWorldRepository,
} from '../../data/mock/InMemoryRepositories'
import { AccountUseCase } from '../../domain/usecases/AccountUseCase'
import { ChatUseCase } from '../../domain/usecases/ChatUseCase'
import { CreditUseCase } from '../../domain/usecases/CreditUseCase'
import { FeedbackUseCase } from '../../domain/usecases/FeedbackUseCase'
import { ForkUseCase } from '../../domain/usecases/ForkUseCase'
import { InboxUseCase } from '../../domain/usecases/InboxUseCase'
import { LibraryUseCase } from '../../domain/usecases/LibraryUseCase'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import { StudioUseCase } from '../../domain/usecases/StudioUseCase'
import { ShellUseCase } from '../../domain/usecases/ShellUseCase'
import type { AppContainer } from './types'

/** Core 업무 API가 생기기 전까지 Repository는 메모리 구현을 씁니다. HTTP 구현이 생기면 이 등록만 바꿉니다. */
export function registerAppServices(container: AppContainer) {
  container.register({
    mockDb: asValue(createMockDb()),
    workRepository: asFunction(({ mockDb }) => new InMemoryWorkRepository(mockDb)).singleton(),
    readingRepository: asFunction(({ mockDb }) => new InMemoryReadingRepository(mockDb)).singleton(),
    notificationRepository: asFunction(({ mockDb }) => new InMemoryNotificationRepository(mockDb)).singleton(),
    feedbackRepository: asFunction(({ mockDb }) => new InMemoryFeedbackRepository(mockDb)).singleton(),
    worldRepository: asFunction(({ mockDb }) => new InMemoryWorldRepository(mockDb)).singleton(),
    creditRepository: asFunction(({ mockDb }) => new InMemoryCreditRepository(mockDb)).singleton(),
    inquiryRepository: asFunction(({ mockDb }) => new InMemoryInquiryRepository(mockDb)).singleton(),
    accountUseCase: asFunction(({ workRepository, worldRepository, readingRepository, inquiryRepository }) => new AccountUseCase(workRepository, worldRepository, readingRepository, inquiryRepository)).singleton(),
    chatRepository: asFunction(({ mockDb }) => new InMemoryChatRepository(mockDb)).singleton(),
    chatUseCase: asFunction(({ workRepository, readingRepository, chatRepository }) => new ChatUseCase(workRepository, readingRepository, chatRepository)).singleton(),
    inboxUseCase: asFunction(({ workRepository, feedbackRepository }) => new InboxUseCase(workRepository, feedbackRepository)).singleton(),
    libraryUseCase: asFunction(({ workRepository, worldRepository, readingRepository, feedbackRepository }) => new LibraryUseCase(workRepository, worldRepository, readingRepository, feedbackRepository)).singleton(),
    creditUseCase: asFunction(({ creditRepository }) => new CreditUseCase(creditRepository)).singleton(),
    readingUseCase: asFunction(({ workRepository, readingRepository }) => new ReadingUseCase(workRepository, readingRepository)).singleton(),
    feedbackUseCase: asFunction(({ workRepository, feedbackRepository }) => new FeedbackUseCase(workRepository, feedbackRepository)).singleton(),
    forkUseCase: asFunction(({ workRepository }) => new ForkUseCase(workRepository)).singleton(),
    studioUseCase: asFunction(({ workRepository, creditRepository, feedbackRepository }) => new StudioUseCase(workRepository, creditRepository, feedbackRepository)).singleton(),
    shellUseCase: asFunction(({ notificationRepository, feedbackRepository }) => new ShellUseCase(notificationRepository, feedbackRepository)).singleton(),
  })
}
