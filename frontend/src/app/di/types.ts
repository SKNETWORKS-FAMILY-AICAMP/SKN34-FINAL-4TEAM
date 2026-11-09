import type { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import type { EpisodeRepository } from '../../domain/repositories/EpisodeRepository'
import type { AwilixContainer } from 'awilix/browser'

import type { CoreApiHealth } from '../../domain/entities/serviceHealth'
import type { OpenNotificationStream } from '../../domain/entities/notificationStream'
import type { MockDb } from '../../data/mock/InMemoryRepositories'
import type { ProfileRepository } from '../../domain/repositories/ProfileRepository'
import type { ProfileUseCase } from '../../domain/usecases/ProfileUseCase'
import type { AuthRepository } from '../../domain/repositories/AuthRepository'
import type { AuthUseCase } from '../../domain/usecases/AuthUseCase'
import type { SignupRepository } from '../../domain/repositories/SignupRepository'
import type { SignupUseCase } from '../../domain/usecases/SignupUseCase'
import type { AdminRepository } from '../../domain/repositories/AdminRepository'
import type { ChatRepository } from '../../domain/repositories/ChatRepository'
import type { CreditRepository } from '../../domain/repositories/CreditRepository'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { WorkLikeRepository } from '../../domain/repositories/WorkLikeRepository'
import type { WorkSearchRepository } from '../../domain/repositories/WorkSearchRepository'
import type { WorldRepository } from '../../domain/repositories/WorldRepository'
import type { AdminUseCase } from '../../domain/usecases/AdminUseCase'
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
  operationsRepository: import('../../domain/repositories/OperationsRepository').OperationsRepository
  operationsUseCase: import('../../domain/usecases/OperationsUseCase').OperationsUseCase
  noticeRepository: import('../../domain/repositories/NoticeRepository').NoticeRepository
  noticeUseCase: import('../../domain/usecases/NoticeUseCase').NoticeUseCase
  reportRepository: import('../../domain/repositories/ReportRepository').ReportRepository
  reportUseCase: import('../../domain/usecases/ReportUseCase').ReportUseCase
  memberRepository: import('../../domain/repositories/MemberRepository').MemberRepository
  memberUseCase: import('../../domain/usecases/MemberUseCase').MemberUseCase
  supportInquiryRepository: import('../../domain/repositories/SupportInquiryRepository').SupportInquiryRepository
  supportInquiryUseCase: import('../../domain/usecases/SupportInquiryUseCase').SupportInquiryUseCase
  eventRepository: import('../../domain/repositories/EventRepository').EventRepository
  eventUseCase: import('../../domain/usecases/EventUseCase').EventUseCase
  operationsWorkRepository: import('../../domain/repositories/OperationsWorkRepository').OperationsWorkRepository
  operationsWorkUseCase: import('../../domain/usecases/OperationsWorkUseCase').OperationsWorkUseCase
  storyPlanUseCase: import('../../domain/usecases/StoryPlanUseCase').StoryPlanUseCase
  demoStoryPlanUseCase: import('../../domain/usecases/StoryPlanUseCase').StoryPlanUseCase
  worldStudioUseCase: import('../../domain/usecases/WorldStudioUseCase').WorldStudioUseCase
  mediaUseCase: import('../../domain/usecases/MediaUseCase').MediaUseCase
  mediaRepository: import('../../domain/repositories/MediaRepository').MediaRepository
  manuscriptUseCase: import('../../domain/usecases/ManuscriptUseCase').ManuscriptUseCase
  manuscriptRepository: import('../../domain/repositories/ManuscriptRepository').ManuscriptRepository
  episodeUseCase: EpisodeUseCase
  episodeRepository: EpisodeRepository
  episodeCommentUseCase: import('../../domain/usecases/EpisodeCommentUseCase').EpisodeCommentUseCase
  episodeCommentRepository: import('../../domain/repositories/EpisodeCommentRepository').EpisodeCommentRepository
  openNotificationStream: OpenNotificationStream
  fetchCoreApiHealth: FetchCoreApiHealth
  fetchAiServiceHealth: FetchCoreApiHealth
  profileRepository: ProfileRepository
  profileUseCase: ProfileUseCase
  authRepository: AuthRepository
  authUseCase: AuthUseCase
  signupRepository: SignupRepository
  signupUseCase: SignupUseCase
  mockDb: MockDb
  workRepository: WorkRepository
  workSearchRepository: WorkSearchRepository
  workLikeRepository: WorkLikeRepository
  readingRepository: ReadingRepository
  notificationRepository: NotificationRepository
  feedbackRepository: FeedbackRepository
  worldRepository: WorldRepository
  creditRepository: CreditRepository
  chatRepository: ChatRepository
  adminRepository: AdminRepository
  adminUseCase: AdminUseCase
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
