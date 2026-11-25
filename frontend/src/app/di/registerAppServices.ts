import { ImageGenerationUseCase } from "../../domain/usecases/ImageGenerationUseCase"
import { HttpImageGenerationRepository } from "../../data/api/HttpImageGenerationRepository"
import {ManuscriptBuildUseCase} from '../../domain/usecases/ManuscriptBuildUseCase'
import {HttpManuscriptBuildRepository} from '../../data/content/HttpManuscriptBuildRepository'
import {InitialWorldUseCase} from '../../domain/usecases/InitialWorldUseCase'
import {HttpInitialWorldRepository} from '../../data/world-studio/HttpInitialWorldRepository'
import {WorldReviewUseCase} from '../../domain/usecases/WorldReviewUseCase'
import {HttpWorldReviewRepository} from '../../data/world-studio/HttpWorldReviewRepository'
import { OperationsUseCase } from '../../domain/usecases/OperationsUseCase'
import { MemberUseCase } from '../../domain/usecases/MemberUseCase'
import { NoticeUseCase } from '../../domain/usecases/NoticeUseCase'
import { ReportUseCase } from '../../domain/usecases/ReportUseCase'
import { SupportInquiryUseCase } from '../../domain/usecases/SupportInquiryUseCase'
import { EventUseCase } from '../../domain/usecases/EventUseCase'
import { OperationsWorkUseCase } from '../../domain/usecases/OperationsWorkUseCase'
import { OperationsGenreUseCase } from '../../domain/usecases/OperationsGenreUseCase'
import { GenreUseCase } from '../../domain/usecases/GenreUseCase'
import { CardCategoryUseCase } from '../../domain/usecases/CardCategoryUseCase'
import { OperationsCardCategoryUseCase } from '../../domain/usecases/OperationsCardCategoryUseCase'
import { OperationsWorldUseCase } from '../../domain/usecases/OperationsWorldUseCase'
import { OperationsCommentUseCase } from '../../domain/usecases/OperationsCommentUseCase'
import { OperationsFeedbackReportUseCase } from '../../domain/usecases/OperationsFeedbackReportUseCase'
import { OperationsCreditUseCase } from '../../domain/usecases/OperationsCreditUseCase'
import { AdminActivityUseCase } from '../../domain/usecases/AdminActivityUseCase'
import { JobMonitorUseCase } from '../../domain/usecases/JobMonitorUseCase'
import { LlmOpsUseCase } from '../../domain/usecases/LlmOpsUseCase'
import { OperationsDashboardUseCase } from '../../domain/usecases/OperationsDashboardUseCase'
import { HttpEventRepository } from '../../data/api/HttpEventRepository'
import { HttpOperationsCreditRepository } from '../../data/api/HttpOperationsCreditRepository'
import { HttpOperationsFeedbackReportRepository } from '../../data/api/HttpOperationsFeedbackReportRepository'
import { HttpAdminActivityRepository, HttpMemberRepository, HttpOperationsCommentRepository, HttpOperationsWorkRepository, HttpOperationsWorldRepository, HttpReportRepository, HttpSupportInquiryRepository } from '../../data/api/operationsApi'
import { HttpNoticeRepository } from '../../data/api/noticeApi'
import { HttpOperationsGenreRepository } from '../../data/api/genreApi'
import { HttpGenreRepository } from '../../data/content/HttpGenreRepository'
import { HttpCardCategoryRepository } from '../../data/content/HttpCardCategoryRepository'
import { HttpOperationsCardCategoryRepository } from '../../data/api/cardCategoryApi'
import { HttpJobMonitorRepository, HttpLlmOpsRepository, HttpOperationsDashboardRepository } from '../../data/api/llmOpsApi'
import { InMemoryOperationsRepository } from '../../data/mock/InMemoryOperationsRepository'
import {WorldStudioUseCase} from '../../domain/usecases/WorldStudioUseCase'
import { StoryPlanUseCase } from '../../domain/usecases/StoryPlanUseCase'
import { HttpStoryPlanRepository } from '../../data/plans/HttpStoryPlanRepository'
import { InMemoryStoryPlanRepository } from '../../data/plans/InMemoryStoryPlanRepository'
import {HttpWorldStudioRepository} from '../../data/world-studio/HttpWorldStudioRepository'
import { PublicWorldUseCase } from '../../domain/usecases/PublicWorldUseCase'
import { HttpPublicWorldRepository } from '../../data/world-studio/HttpPublicWorldRepository'
import { MediaUseCase } from '../../domain/usecases/MediaUseCase'
import { HttpMediaRepository } from '../../data/content/HttpMediaRepository'
import { ManuscriptUseCase } from '../../domain/usecases/ManuscriptUseCase'
import { HttpManuscriptRepository } from '../../data/content/HttpManuscriptRepository'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { EpisodeCommentUseCase } from '../../domain/usecases/EpisodeCommentUseCase'
import { EditSuggestionUseCase } from '../../domain/usecases/EditSuggestionUseCase'
import { FeedbackReportUseCase } from '../../domain/usecases/FeedbackReportUseCase'
import { HttpCreditLedgerRepository } from '../../data/api/HttpCreditLedgerRepository'
import { HttpWithdrawalRepository } from '../../data/api/HttpWithdrawalRepository'
import { HttpNotificationRepository } from '../../data/api/HttpNotificationRepository'
import { HttpEpisodeCommentRepository } from '../../data/content/HttpEpisodeCommentRepository'
import { HttpWorkNoticeRepository } from '../../data/content/HttpWorkNoticeRepository'
import { InMemoryWorkNoticeRepository } from '../../data/mock/InMemoryWorkNoticeRepository'
import { WorkNoticeUseCase } from '../../domain/usecases/WorkNoticeUseCase'
import { HttpSerialRepository } from '../../data/content/HttpSerialRepository'
import { SerialUseCase } from '../../domain/usecases/SerialUseCase'
import { HttpEditSuggestionRepository } from '../../data/content/HttpEditSuggestionRepository'
import { HttpFeedbackReportRepository } from '../../data/content/HttpFeedbackReportRepository'
import { HttpWritingChatRepository } from '../../data/content/HttpWritingChatRepository'
import { WritingChatUseCase } from '../../domain/usecases/WritingChatUseCase'
import { HttpEpisodeRepository } from '../../data/content/HttpEpisodeRepository'
import { HttpReadingRecordRepository } from '../../data/content/HttpReadingRecordRepository'
import { HttpWorkRepository } from '../../data/content/HttpWorkRepository'
import { HttpWorkInterestRepository } from '../../data/content/HttpWorkInterestRepository'
import { WorkInterestUseCase } from '../../domain/usecases/WorkInterestUseCase'
import { HttpWorkLikeRepository } from '../../data/content/HttpWorkLikeRepository'
import { asFunction, asValue } from 'awilix/browser'

import {
  createMockDb,
  InMemoryAdminRepository,
  InMemoryChatRepository,
  InMemoryCreditRepository,
  InMemoryFeedbackRepository,
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
import { CreditLedgerUseCase } from '../../domain/usecases/CreditLedgerUseCase'
import { WithdrawalUseCase } from '../../domain/usecases/WithdrawalUseCase'
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
    imageGenerationRepository: asFunction(() => new HttpImageGenerationRepository()).singleton(),
    imageGenerationUseCase: asFunction(({ imageGenerationRepository }) => new ImageGenerationUseCase(imageGenerationRepository)).singleton(),
    operationsRepository: asFunction(() => new InMemoryOperationsRepository()).singleton(),
    operationsUseCase: asFunction(({ operationsRepository }) => new OperationsUseCase(operationsRepository)).singleton(),
    noticeRepository: asFunction(() => new HttpNoticeRepository()).singleton(),
    noticeUseCase: asFunction(({ noticeRepository }) => new NoticeUseCase(noticeRepository)).singleton(),
    reportRepository: asFunction(() => new HttpReportRepository()).singleton(),
    reportUseCase: asFunction(({ reportRepository }) => new ReportUseCase(reportRepository)).singleton(),
    memberRepository: asFunction(() => new HttpMemberRepository()).singleton(),
    memberUseCase: asFunction(({ memberRepository }) => new MemberUseCase(memberRepository)).singleton(),
    supportInquiryRepository: asFunction(() => new HttpSupportInquiryRepository()).singleton(),
    supportInquiryUseCase: asFunction(({ supportInquiryRepository }) => new SupportInquiryUseCase(supportInquiryRepository)).singleton(),
    eventRepository: asFunction(() => new HttpEventRepository()).singleton(),
    eventUseCase: asFunction(({ eventRepository }) => new EventUseCase(eventRepository)).singleton(),
    operationsWorkRepository: asFunction(() => new HttpOperationsWorkRepository()).singleton(),
    operationsWorkUseCase: asFunction(({ operationsWorkRepository }) => new OperationsWorkUseCase(operationsWorkRepository)).singleton(),
    genreRepository: asFunction(() => new HttpGenreRepository()).singleton(),
    genreUseCase: asFunction(({ genreRepository }) => new GenreUseCase(genreRepository)).singleton(),
    operationsGenreRepository: asFunction(() => new HttpOperationsGenreRepository()).singleton(),
    operationsGenreUseCase: asFunction(({ operationsGenreRepository }) => new OperationsGenreUseCase(operationsGenreRepository)).singleton(),
    cardCategoryRepository: asFunction(() => new HttpCardCategoryRepository()).singleton(),
    cardCategoryUseCase: asFunction(({ cardCategoryRepository }) => new CardCategoryUseCase(cardCategoryRepository)).singleton(),
    operationsCardCategoryRepository: asFunction(() => new HttpOperationsCardCategoryRepository()).singleton(),
    operationsCardCategoryUseCase: asFunction(({ operationsCardCategoryRepository }) => new OperationsCardCategoryUseCase(operationsCardCategoryRepository)).singleton(),
    operationsWorldRepository: asFunction(() => new HttpOperationsWorldRepository()).singleton(),
    operationsWorldUseCase: asFunction(({ operationsWorldRepository }) => new OperationsWorldUseCase(operationsWorldRepository)).singleton(),
    operationsCreditRepository: asFunction(() => new HttpOperationsCreditRepository()).singleton(),
    operationsCreditUseCase: asFunction(({ operationsCreditRepository }) => new OperationsCreditUseCase(operationsCreditRepository)).singleton(),
    operationsCommentRepository: asFunction(() => new HttpOperationsCommentRepository()).singleton(),
    operationsCommentUseCase: asFunction(({ operationsCommentRepository }) => new OperationsCommentUseCase(operationsCommentRepository)).singleton(),
    operationsFeedbackReportRepository: asFunction(() => new HttpOperationsFeedbackReportRepository()).singleton(),
    operationsFeedbackReportUseCase: asFunction(({ operationsFeedbackReportRepository }) => new OperationsFeedbackReportUseCase(operationsFeedbackReportRepository)).singleton(),
    adminActivityRepository: asFunction(() => new HttpAdminActivityRepository()).singleton(),
    adminActivityUseCase: asFunction(({ adminActivityRepository }) => new AdminActivityUseCase(adminActivityRepository)).singleton(),
    operationsDashboardRepository: asFunction(() => new HttpOperationsDashboardRepository()).singleton(),
    operationsDashboardUseCase: asFunction(({ operationsDashboardRepository }) => new OperationsDashboardUseCase(operationsDashboardRepository)).singleton(),
    llmOpsRepository: asFunction(() => new HttpLlmOpsRepository()).singleton(),
    llmOpsUseCase: asFunction(({ llmOpsRepository }) => new LlmOpsUseCase(llmOpsRepository)).singleton(),
    jobMonitorRepository: asFunction(() => new HttpJobMonitorRepository()).singleton(),
    jobMonitorUseCase: asFunction(({ jobMonitorRepository }) => new JobMonitorUseCase(jobMonitorRepository)).singleton(),
    initialWorldUseCase: asFunction(() => new InitialWorldUseCase(new HttpInitialWorldRepository())).singleton(),
    worldStudioUseCase: asFunction(() => new WorldStudioUseCase(new HttpWorldStudioRepository())).singleton(),
    worldReviewUseCase: asFunction(() => new WorldReviewUseCase(new HttpWorldReviewRepository())).singleton(),
    publicWorldRepository: asFunction(() => new HttpPublicWorldRepository()).singleton(),
    publicWorldUseCase: asFunction(({ publicWorldRepository, genreRepository }) => new PublicWorldUseCase(publicWorldRepository, genreRepository)).singleton(),
    profileRepository: asValue(profileRepository),
    profileUseCase: asFunction(({ profileRepository }) => new ProfileUseCase(profileRepository)).singleton(),
    authRepository: asValue(authRepository),
    authUseCase: asFunction(({ authRepository }) => new AuthUseCase(authRepository)).singleton(),
    signupRepository: asValue(signupRepository),
    signupUseCase: asFunction(({ signupRepository }) => new SignupUseCase(signupRepository)).singleton(),
    mediaRepository: asFunction(() => new HttpMediaRepository()).singleton(),
    mediaUseCase: asFunction(({ mediaRepository }) => new MediaUseCase(mediaRepository)).singleton(),
    manuscriptBuildRepository: asFunction(() => new HttpManuscriptBuildRepository()).singleton(),
    manuscriptBuildUseCase: asFunction(({manuscriptBuildRepository}) => new ManuscriptBuildUseCase(manuscriptBuildRepository)).singleton(),
    manuscriptRepository: asFunction(() => new HttpManuscriptRepository()).singleton(),
    manuscriptUseCase: asFunction(({ manuscriptRepository }) => new ManuscriptUseCase(manuscriptRepository)).singleton(),
    episodeRepository: asFunction(() => new HttpEpisodeRepository()).singleton(),
    episodeUseCase: asFunction(({ episodeRepository }) => new EpisodeUseCase(episodeRepository)).singleton(),
    writingChatUseCase: asFunction(() => new WritingChatUseCase(new HttpWritingChatRepository())).singleton(),
    episodeCommentRepository: asFunction(() => new HttpEpisodeCommentRepository()).singleton(),
    episodeCommentUseCase: asFunction(({ episodeCommentRepository }) => new EpisodeCommentUseCase(episodeCommentRepository)).singleton(),
    workNoticeRepository: asFunction(() => new HttpWorkNoticeRepository()).singleton(),
    workNoticeUseCase: asFunction(({ workNoticeRepository }) => new WorkNoticeUseCase(workNoticeRepository)).singleton(),
    // 메모리 데모 작품(`--mode mockup`·테스트)의 소식. 실제 작품은 위 HTTP 저장소를 쓰고, 이 저장소는 서버에 저장하지 않는다.
    demoWorkNoticeUseCase: asFunction(() => new WorkNoticeUseCase(new InMemoryWorkNoticeRepository())).singleton(),
    // AI 자율 연재(UC-18): 실제 작품 전용이라 데모(메모리) 대역은 없고, 화면은 데모 작품에서 이 UseCase를 부르지 않는다.
    serialRepository: asFunction(() => new HttpSerialRepository()).singleton(),
    serialUseCase: asFunction(({ serialRepository }) => new SerialUseCase(serialRepository)).singleton(),
    editSuggestionRepository: asFunction(() => new HttpEditSuggestionRepository()).singleton(),
    editSuggestionUseCase: asFunction(({ editSuggestionRepository }) => new EditSuggestionUseCase(editSuggestionRepository)).singleton(),
    feedbackReportRepository: asFunction(() => new HttpFeedbackReportRepository()).singleton(),
    feedbackReportUseCase: asFunction(({ feedbackReportRepository }) => new FeedbackReportUseCase(feedbackReportRepository)).singleton(),
    storyPlanUseCase: asFunction(({ episodeRepository }) => new StoryPlanUseCase(new HttpStoryPlanRepository(episodeRepository))).singleton(),
    demoStoryPlanUseCase: asFunction(({ workRepository }) => new StoryPlanUseCase(new InMemoryStoryPlanRepository(workRepository))).singleton(),
    mockDb: asValue(createMockDb()),
    workRepository: asFunction(() => new HttpWorkRepository()).singleton(),
    workSearchRepository: asFunction(() => new HttpEpisodeRepository()).singleton(),
    workInterestRepository: asFunction(() => new HttpWorkInterestRepository()).singleton(),
    workInterestUseCase: asFunction(({ workInterestRepository }) => new WorkInterestUseCase(workInterestRepository)).singleton(),
    workLikeRepository: asFunction(() => new HttpWorkLikeRepository()).singleton(),
    readingRepository: asFunction(({ mockDb }) => new InMemoryReadingRepository(mockDb)).singleton(),
    readingRecordRepository: asFunction(() => new HttpReadingRecordRepository()).singleton(),
    notificationRepository: asFunction(() => new HttpNotificationRepository()).singleton(),
    feedbackRepository: asFunction(({ mockDb }) => new InMemoryFeedbackRepository(mockDb)).singleton(),
    worldRepository: asFunction(({ mockDb }) => new InMemoryWorldRepository(mockDb)).singleton(),
    creditRepository: asFunction(({ mockDb }) => new InMemoryCreditRepository(mockDb)).singleton(),
    adminRepository: asFunction(({ mockDb }) => new InMemoryAdminRepository(mockDb)).singleton(),
    adminUseCase: asFunction(({ adminRepository, workRepository, feedbackRepository, creditRepository, chatRepository }) => new AdminUseCase(adminRepository, workRepository, feedbackRepository, creditRepository, chatRepository)).singleton(),
    accountUseCase: asFunction(({ workRepository, workInterestRepository, adminRepository, episodeRepository }) => new AccountUseCase(workRepository, workInterestRepository, adminRepository, episodeRepository)).singleton(),
    chatRepository: asFunction(({ mockDb }) => new InMemoryChatRepository(mockDb)).singleton(),
    chatUseCase: asFunction(({ workRepository, readingRepository, chatRepository }) => new ChatUseCase(workRepository, readingRepository, chatRepository)).singleton(),
    inboxUseCase: asFunction(({ workRepository, feedbackRepository }) => new InboxUseCase(workRepository, feedbackRepository)).singleton(),
    libraryUseCase: asFunction(({ workRepository, worldRepository, feedbackRepository, workInterestRepository, readingRecordRepository }) => new LibraryUseCase(workRepository, worldRepository, feedbackRepository, workInterestRepository, readingRecordRepository)).singleton(),
    creditUseCase: asFunction(({ creditRepository }) => new CreditUseCase(creditRepository)).singleton(),
    creditLedgerRepository: asFunction(() => new HttpCreditLedgerRepository()).singleton(),
    creditLedgerUseCase: asFunction(({ creditLedgerRepository }) => new CreditLedgerUseCase(creditLedgerRepository)).singleton(),
    withdrawalRepository: asFunction(() => new HttpWithdrawalRepository()).singleton(),
    withdrawalUseCase: asFunction(({ withdrawalRepository }) => new WithdrawalUseCase(withdrawalRepository)).singleton(),
    readingUseCase: asFunction(({ workRepository, readingRepository, readingRecordRepository, workSearchRepository, workLikeRepository, genreRepository }) => new ReadingUseCase(workRepository, readingRepository, readingRecordRepository, workSearchRepository, workLikeRepository, genreRepository)).singleton(),
    feedbackUseCase: asFunction(({ workRepository, feedbackRepository, adminRepository, feedbackReportUseCase }) => new FeedbackUseCase(workRepository, feedbackRepository, adminRepository, feedbackReportUseCase)).singleton(),
    forkUseCase: asFunction(({ workRepository }) => new ForkUseCase(workRepository)).singleton(),
    studioUseCase: asFunction(({ workRepository, creditRepository, feedbackRepository, worldRepository }) => new StudioUseCase(workRepository, creditRepository, feedbackRepository, worldRepository)).singleton(),
    shellUseCase: asFunction(({ notificationRepository, feedbackRepository }) => new ShellUseCase(notificationRepository, feedbackRepository)).singleton(),
  })
}
