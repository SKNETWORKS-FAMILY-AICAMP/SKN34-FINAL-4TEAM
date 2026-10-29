import { asFunction, asValue } from 'awilix/browser'

import {
  createMockDb,
  InMemoryFeedbackRepository,
  InMemoryNotificationRepository,
  InMemoryReadingRepository,
  InMemoryWorkRepository,
} from '../../data/mock/InMemoryRepositories'
import { FeedbackUseCase } from '../../domain/usecases/FeedbackUseCase'
import { ForkUseCase } from '../../domain/usecases/ForkUseCase'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
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
    readingUseCase: asFunction(({ workRepository, readingRepository }) => new ReadingUseCase(workRepository, readingRepository)).singleton(),
    feedbackUseCase: asFunction(({ workRepository, feedbackRepository }) => new FeedbackUseCase(workRepository, feedbackRepository)).singleton(),
    forkUseCase: asFunction(({ workRepository }) => new ForkUseCase(workRepository)).singleton(),
    shellUseCase: asFunction(({ notificationRepository }) => new ShellUseCase(notificationRepository)).singleton(),
  })
}
