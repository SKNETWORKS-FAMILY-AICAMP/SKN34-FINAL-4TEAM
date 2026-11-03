import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { HttpEpisodeRepository } from '../../data/content/HttpEpisodeRepository'
import { asFunction, asValue } from 'awilix/browser'

import {
  createMockDb,
  InMemoryAdminRepository,
  InMemoryChatRepository,
  InMemoryCreditRepository,
  InMemoryFeedbackRepository,
  InMemoryInquiryRepository,
  InMemoryNotificationRepository,
  InMemoryReadingRepository,
  InMemoryWorkRepository,
  InMemoryWorldRepository,
} from '../../data/mock/InMemoryRepositories'
import { profileRepository } from '../../data/api/profile'
import { ProfileUseCase } from '../../domain/usecases/ProfileUseCase'
import { signupRepository } from '../../data/api/signup'
import * as authRepository from '../../data/api/auth'
import { AuthUseCase } from '../../domain/usecases/AuthUseCase'
import { SignupUseCase } from '../../domain/usecases/SignupUseCase'
import { AdminUseCase } from '../../domain/usecases/AdminUseCase'
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

/** 콘텐츠는 HTTP API를 사용하며, 기존 서재·열람·Fork 등 데모는 메모리 구현을 유지합니다. */
export function registerAppServices(container: AppContainer) {
  container.register({
    profileRepository: asValue(profileRepository),
    profileUseCase: asFunction(({ profileRepository }) => new ProfileUseCase(profileRepository)).singleton(),
    authRepository: asValue(authRepository),
    authUseCase: asFunction(({ authRepository }) => new AuthUseCase(authRepository)).singleton(),
    signupRepository: asValue(signupRepository),
    signupUseCase: asFunction(({ signupRepository }) => new SignupUseCase(signupRepository)).singleton(),
    episodeRepository: asFunction(() => new HttpEpisodeRepository()).singleton(),
    episodeUseCase: asFunction(({ episodeRepository }) => new EpisodeUseCase(episodeRepository)).singleton(),
    mockDb: asValue(createMockDb()),
    workRepository: asFunction(({ mockDb }) => new InMemoryWorkRepository(mockDb)).singleton(),
    readingRepository: asFunction(({ mockDb }) => new InMemoryReadingRepository(mockDb)).singleton(),
    notificationRepository: asFunction(({ mockDb }) => new InMemoryNotificationRepository(mockDb)).singleton(),
    feedbackRepository: asFunction(({ mockDb }) => new InMemoryFeedbackRepository(mockDb)).singleton(),
    worldRepository: asFunction(({ mockDb }) => new InMemoryWorldRepository(mockDb)).singleton(),
    creditRepository: asFunction(({ mockDb }) => new InMemoryCreditRepository(mockDb)).singleton(),
    inquiryRepository: asFunction(({ mockDb }) => new InMemoryInquiryRepository(mockDb)).singleton(),
    adminRepository: asFunction(({ mockDb }) => new InMemoryAdminRepository(mockDb)).singleton(),
    adminUseCase: asFunction(({ adminRepository, workRepository, feedbackRepository, inquiryRepository, creditRepository, chatRepository }) => new AdminUseCase(adminRepository, workRepository, feedbackRepository, inquiryRepository, creditRepository, chatRepository)).singleton(),
    accountUseCase: asFunction(({ workRepository, worldRepository, readingRepository, inquiryRepository, adminRepository }) => new AccountUseCase(workRepository, worldRepository, readingRepository, inquiryRepository, adminRepository)).singleton(),
    chatRepository: asFunction(({ mockDb }) => new InMemoryChatRepository(mockDb)).singleton(),
    chatUseCase: asFunction(({ workRepository, readingRepository, chatRepository }) => new ChatUseCase(workRepository, readingRepository, chatRepository)).singleton(),
    inboxUseCase: asFunction(({ workRepository, feedbackRepository }) => new InboxUseCase(workRepository, feedbackRepository)).singleton(),
    libraryUseCase: asFunction(({ workRepository, worldRepository, readingRepository, feedbackRepository }) => new LibraryUseCase(workRepository, worldRepository, readingRepository, feedbackRepository)).singleton(),
    creditUseCase: asFunction(({ creditRepository }) => new CreditUseCase(creditRepository)).singleton(),
    readingUseCase: asFunction(({ workRepository, readingRepository }) => new ReadingUseCase(workRepository, readingRepository)).singleton(),
    feedbackUseCase: asFunction(({ workRepository, feedbackRepository, adminRepository }) => new FeedbackUseCase(workRepository, feedbackRepository, adminRepository)).singleton(),
    forkUseCase: asFunction(({ workRepository }) => new ForkUseCase(workRepository)).singleton(),
    studioUseCase: asFunction(({ workRepository, creditRepository, feedbackRepository, worldRepository }) => new StudioUseCase(workRepository, creditRepository, feedbackRepository, worldRepository)).singleton(),
    shellUseCase: asFunction(({ notificationRepository, feedbackRepository }) => new ShellUseCase(notificationRepository, feedbackRepository)).singleton(),
  })
}
