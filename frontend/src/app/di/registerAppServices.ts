import { OperationsUseCase } from '../../domain/usecases/OperationsUseCase'
import { MemberUseCase } from '../../domain/usecases/MemberUseCase'
import { ReportUseCase } from '../../domain/usecases/ReportUseCase'
import { HttpMemberRepository, HttpReportRepository } from '../../data/api/operationsApi'
import { InMemoryOperationsRepository } from '../../data/mock/InMemoryOperationsRepository'
import {WorldStudioUseCase} from '../../domain/usecases/WorldStudioUseCase'
import { StoryPlanUseCase } from '../../domain/usecases/StoryPlanUseCase'
import { HttpStoryPlanRepository } from '../../data/plans/HttpStoryPlanRepository'
import { InMemoryStoryPlanRepository } from '../../data/plans/InMemoryStoryPlanRepository'
import {HttpWorldStudioRepository} from '../../data/world-studio/HttpWorldStudioRepository'
import { MediaUseCase } from '../../domain/usecases/MediaUseCase'
import { HttpMediaRepository } from '../../data/content/HttpMediaRepository'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { HttpNotificationRepository } from '../../data/api/HttpNotificationRepository'
import { HttpEpisodeRepository } from '../../data/content/HttpEpisodeRepository'
import { HttpWorkRepository } from '../../data/content/HttpWorkRepository'
import { asFunction, asValue } from 'awilix/browser'

import {
  createMockDb,
  InMemoryAdminRepository,
  InMemoryChatRepository,
  InMemoryCreditRepository,
  InMemoryFeedbackRepository,
  InMemoryInquiryRepository,
  InMemoryReadingRepository,
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

/** 작품·열람·Fork와 홈 순위·검색은 같은 Content API를 사용한다. 나머지 데모 상태에는 샘플 작품·댓글을 주입하지 않는다. */
export function registerAppServices(container: AppContainer) {
  container.register({
    operationsRepository: asFunction(() => new InMemoryOperationsRepository()).singleton(),
    operationsUseCase: asFunction(({ operationsRepository }) => new OperationsUseCase(operationsRepository)).singleton(),
    reportRepository: asFunction(() => new HttpReportRepository()).singleton(),
    reportUseCase: asFunction(({ reportRepository }) => new ReportUseCase(reportRepository)).singleton(),
    memberRepository: asFunction(() => new HttpMemberRepository()).singleton(),
    memberUseCase: asFunction(({ memberRepository }) => new MemberUseCase(memberRepository)).singleton(),
    worldStudioUseCase: asFunction(() => new WorldStudioUseCase(new HttpWorldStudioRepository())).singleton(),
    profileRepository: asValue(profileRepository),
    profileUseCase: asFunction(({ profileRepository }) => new ProfileUseCase(profileRepository)).singleton(),
    authRepository: asValue(authRepository),
    authUseCase: asFunction(({ authRepository }) => new AuthUseCase(authRepository)).singleton(),
    signupRepository: asValue(signupRepository),
    signupUseCase: asFunction(({ signupRepository }) => new SignupUseCase(signupRepository)).singleton(),
    mediaRepository: asFunction(() => new HttpMediaRepository()).singleton(),
    mediaUseCase: asFunction(({ mediaRepository }) => new MediaUseCase(mediaRepository)).singleton(),
    episodeRepository: asFunction(() => new HttpEpisodeRepository()).singleton(),
    episodeUseCase: asFunction(({ episodeRepository }) => new EpisodeUseCase(episodeRepository)).singleton(),
    storyPlanUseCase: asFunction(({ episodeRepository }) => new StoryPlanUseCase(new HttpStoryPlanRepository(episodeRepository))).singleton(),
    demoStoryPlanUseCase: asFunction(({ workRepository }) => new StoryPlanUseCase(new InMemoryStoryPlanRepository(workRepository))).singleton(),
    mockDb: asValue(createMockDb()),
    workRepository: asFunction(() => new HttpWorkRepository()).singleton(),
    workSearchRepository: asFunction(() => new HttpEpisodeRepository()).singleton(),
    readingRepository: asFunction(({ mockDb }) => new InMemoryReadingRepository(mockDb)).singleton(),
    notificationRepository: asFunction(() => new HttpNotificationRepository()).singleton(),
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
    readingUseCase: asFunction(({ workRepository, readingRepository, workSearchRepository }) => new ReadingUseCase(workRepository, readingRepository, workSearchRepository)).singleton(),
    feedbackUseCase: asFunction(({ workRepository, feedbackRepository, adminRepository }) => new FeedbackUseCase(workRepository, feedbackRepository, adminRepository)).singleton(),
    forkUseCase: asFunction(({ workRepository }) => new ForkUseCase(workRepository)).singleton(),
    studioUseCase: asFunction(({ workRepository, creditRepository, feedbackRepository, worldRepository }) => new StudioUseCase(workRepository, creditRepository, feedbackRepository, worldRepository)).singleton(),
    shellUseCase: asFunction(({ notificationRepository, feedbackRepository }) => new ShellUseCase(notificationRepository, feedbackRepository)).singleton(),
  })
}
