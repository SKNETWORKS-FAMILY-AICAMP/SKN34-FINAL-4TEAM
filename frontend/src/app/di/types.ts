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
import type { CreditLedgerRepository } from '../../domain/repositories/CreditLedgerRepository'
import type { WithdrawalRepository } from '../../domain/repositories/WithdrawalRepository'
import type { CreditRepository } from '../../domain/repositories/CreditRepository'
import type { FeedbackRepository } from '../../domain/repositories/FeedbackRepository'
import type { NotificationRepository } from '../../domain/repositories/NotificationRepository'
import type { ReadingRecordRepository } from '../../domain/repositories/ReadingRecordRepository'
import type { ReadingRepository, WorkRepository } from '../../domain/repositories/WorkRepository'
import type { WorkInterestRepository } from '../../domain/repositories/WorkInterestRepository'
import type { WorkLikeRepository } from '../../domain/repositories/WorkLikeRepository'
import type { WorkSearchRepository } from '../../domain/repositories/WorkSearchRepository'
import type { WorldRepository } from '../../domain/repositories/WorldRepository'
import type { AdminUseCase } from '../../domain/usecases/AdminUseCase'
import type { AccountUseCase } from '../../domain/usecases/AccountUseCase'
import type { ChatUseCase } from '../../domain/usecases/ChatUseCase'
import type { CreditLedgerUseCase } from '../../domain/usecases/CreditLedgerUseCase'
import type { WithdrawalUseCase } from '../../domain/usecases/WithdrawalUseCase'
import type { CreditUseCase } from '../../domain/usecases/CreditUseCase'
import type { FeedbackUseCase } from '../../domain/usecases/FeedbackUseCase'
import type { ForkUseCase } from '../../domain/usecases/ForkUseCase'
import type { InboxUseCase } from '../../domain/usecases/InboxUseCase'
import type { LibraryUseCase } from '../../domain/usecases/LibraryUseCase'
import type { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import type { StudioUseCase } from '../../domain/usecases/StudioUseCase'
import type { ShellUseCase } from '../../domain/usecases/ShellUseCase'
import type { WorkInterestUseCase } from '../../domain/usecases/WorkInterestUseCase'

export type FetchCoreApiHealth = (signal?: AbortSignal) => Promise<CoreApiHealth>

export type AppCradle = {
  imageGenerationRepository: import("../../domain/repositories/ImageGenerationRepository").ImageGenerationRepository
  imageGenerationUseCase: import("../../domain/usecases/ImageGenerationUseCase").ImageGenerationUseCase
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
  operationsCreditRepository: import('../../domain/repositories/OperationsCreditRepository').OperationsCreditRepository
  operationsCreditUseCase: import('../../domain/usecases/OperationsCreditUseCase').OperationsCreditUseCase
  operationsCommentRepository: import('../../domain/repositories/OperationsCommentRepository').OperationsCommentRepository
  operationsCommentUseCase: import('../../domain/usecases/OperationsCommentUseCase').OperationsCommentUseCase
  adminActivityRepository: import('../../domain/repositories/AdminActivityRepository').AdminActivityRepository
  adminActivityUseCase: import('../../domain/usecases/AdminActivityUseCase').AdminActivityUseCase
  operationsDashboardRepository: import('../../domain/repositories/OperationsDashboardRepository').OperationsDashboardRepository
  operationsDashboardUseCase: import('../../domain/usecases/OperationsDashboardUseCase').OperationsDashboardUseCase
  llmOpsRepository: import('../../domain/repositories/LlmOpsRepository').LlmOpsRepository
  llmOpsUseCase: import('../../domain/usecases/LlmOpsUseCase').LlmOpsUseCase
  jobMonitorRepository: import('../../domain/repositories/JobMonitorRepository').JobMonitorRepository
  jobMonitorUseCase: import('../../domain/usecases/JobMonitorUseCase').JobMonitorUseCase
  storyPlanUseCase: import('../../domain/usecases/StoryPlanUseCase').StoryPlanUseCase
  demoStoryPlanUseCase: import('../../domain/usecases/StoryPlanUseCase').StoryPlanUseCase
  initialWorldUseCase: import('../../domain/usecases/InitialWorldUseCase').InitialWorldUseCase | null
  worldStudioUseCase: import('../../domain/usecases/WorldStudioUseCase').WorldStudioUseCase
  worldReviewUseCase: import('../../domain/usecases/WorldReviewUseCase').WorldReviewUseCase | null
  genreRepository: import('../../domain/repositories/GenreRepository').GenreRepository
  genreUseCase: import('../../domain/usecases/GenreUseCase').GenreUseCase
  operationsGenreRepository: import('../../domain/repositories/OperationsGenreRepository').OperationsGenreRepository
  operationsGenreUseCase: import('../../domain/usecases/OperationsGenreUseCase').OperationsGenreUseCase
  cardCategoryRepository: import('../../domain/repositories/CardCategoryRepository').CardCategoryRepository
  cardCategoryUseCase: import('../../domain/usecases/CardCategoryUseCase').CardCategoryUseCase
  operationsCardCategoryRepository: import('../../domain/repositories/OperationsCardCategoryRepository').OperationsCardCategoryRepository
  operationsCardCategoryUseCase: import('../../domain/usecases/OperationsCardCategoryUseCase').OperationsCardCategoryUseCase
  operationsWorldRepository: import('../../domain/repositories/OperationsWorldRepository').OperationsWorldRepository
  operationsWorldUseCase: import('../../domain/usecases/OperationsWorldUseCase').OperationsWorldUseCase
  publicWorldRepository: import('../../domain/repositories/PublicWorldRepository').PublicWorldRepository
  publicWorldUseCase: import('../../domain/usecases/PublicWorldUseCase').PublicWorldUseCase
  mediaUseCase: import('../../domain/usecases/MediaUseCase').MediaUseCase
  mediaRepository: import('../../domain/repositories/MediaRepository').MediaRepository
  manuscriptBuildRepository: import('../../domain/repositories/ManuscriptBuildRepository').ManuscriptBuildRepository
  manuscriptBuildUseCase: import('../../domain/usecases/ManuscriptBuildUseCase').ManuscriptBuildUseCase
  manuscriptUseCase: import('../../domain/usecases/ManuscriptUseCase').ManuscriptUseCase
  manuscriptRepository: import('../../domain/repositories/ManuscriptRepository').ManuscriptRepository
  episodeUseCase: EpisodeUseCase
  /** 집필 AI 채팅(#331). `--mode mockup`은 서버 대화가 없어 null이다. */
  writingChatUseCase: import('../../domain/usecases/WritingChatUseCase').WritingChatUseCase | null
  episodeRepository: EpisodeRepository
  episodeCommentUseCase: import('../../domain/usecases/EpisodeCommentUseCase').EpisodeCommentUseCase
  episodeCommentRepository: import('../../domain/repositories/EpisodeCommentRepository').EpisodeCommentRepository
  workNoticeUseCase: import('../../domain/usecases/WorkNoticeUseCase').WorkNoticeUseCase
  workNoticeRepository: import('../../domain/repositories/WorkNoticeRepository').WorkNoticeRepository
  demoWorkNoticeUseCase: import('../../domain/usecases/WorkNoticeUseCase').WorkNoticeUseCase
  serialUseCase: import('../../domain/usecases/SerialUseCase').SerialUseCase
  serialRepository: import('../../domain/repositories/SerialRepository').SerialRepository
  editSuggestionUseCase: import('../../domain/usecases/EditSuggestionUseCase').EditSuggestionUseCase
  editSuggestionRepository: import('../../domain/repositories/EditSuggestionRepository').EditSuggestionRepository
  feedbackReportUseCase: import('../../domain/usecases/FeedbackReportUseCase').FeedbackReportUseCase
  feedbackReportRepository: import('../../domain/repositories/FeedbackReportRepository').FeedbackReportRepository
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
  workInterestRepository: WorkInterestRepository
  workInterestUseCase: WorkInterestUseCase
  workLikeRepository: WorkLikeRepository
  readingRepository: ReadingRepository
  readingRecordRepository: ReadingRecordRepository
  notificationRepository: NotificationRepository
  feedbackRepository: FeedbackRepository
  worldRepository: WorldRepository
  creditRepository: CreditRepository
  creditLedgerRepository: CreditLedgerRepository
  withdrawalRepository: WithdrawalRepository
  chatRepository: ChatRepository
  adminRepository: AdminRepository
  adminUseCase: AdminUseCase
  accountUseCase: AccountUseCase
  chatUseCase: ChatUseCase
  inboxUseCase: InboxUseCase
  libraryUseCase: LibraryUseCase
  creditUseCase: CreditUseCase
  creditLedgerUseCase: CreditLedgerUseCase
  withdrawalUseCase: WithdrawalUseCase
  readingUseCase: ReadingUseCase
  feedbackUseCase: FeedbackUseCase
  forkUseCase: ForkUseCase
  studioUseCase: StudioUseCase
  shellUseCase: ShellUseCase
}

export type AppContainer = AwilixContainer<AppCradle>
