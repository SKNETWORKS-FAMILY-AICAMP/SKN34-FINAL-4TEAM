import {InitialWorldUseCase} from '../../domain/usecases/InitialWorldUseCase'
import {HttpInitialWorldRepository} from '../../data/world-studio/HttpInitialWorldRepository'
import { OperationsUseCase } from '../../domain/usecases/OperationsUseCase'
import { MemberUseCase } from '../../domain/usecases/MemberUseCase'
import { NoticeUseCase } from '../../domain/usecases/NoticeUseCase'
import { ReportUseCase } from '../../domain/usecases/ReportUseCase'
import { SupportInquiryUseCase } from '../../domain/usecases/SupportInquiryUseCase'
import { EventUseCase } from '../../domain/usecases/EventUseCase'
import { OperationsWorkUseCase } from '../../domain/usecases/OperationsWorkUseCase'
import { OperationsCommentUseCase } from '../../domain/usecases/OperationsCommentUseCase'
import { AdminActivityUseCase } from '../../domain/usecases/AdminActivityUseCase'
import { HttpEventRepository } from '../../data/api/HttpEventRepository'
import { HttpAdminActivityRepository, HttpMemberRepository, HttpOperationsCommentRepository, HttpOperationsWorkRepository, HttpReportRepository, HttpSupportInquiryRepository } from '../../data/api/operationsApi'
import { HttpNoticeRepository } from '../../data/api/noticeApi'
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
import { HttpEditSuggestionRepository } from '../../data/content/HttpEditSuggestionRepository'
import { HttpFeedbackReportRepository } from '../../data/content/HttpFeedbackReportRepository'
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
    operationsCommentRepository: asFunction(() => new HttpOperationsCommentRepository()).singleton(),
    operationsCommentUseCase: asFunction(({ operationsCommentRepository }) => new OperationsCommentUseCase(operationsCommentRepository)).singleton(),
    adminActivityRepository: asFunction(() => new HttpAdminActivityRepository()).singleton(),
    adminActivityUseCase: asFunction(({ adminActivityRepository }) => new AdminActivityUseCase(adminActivityRepository)).singleton(),
    initialWorldUseCase: asFunction(() => new InitialWorldUseCase(new HttpInitialWorldRepository())).singleton(),
    worldStudioUseCase: asFunction(() => new WorldStudioUseCase(new HttpWorldStudioRepository())).singleton(),
    publicWorldRepository: asFunction(() => new HttpPublicWorldRepository()).singleton(),
    publicWorldUseCase: asFunction(({ publicWorldRepository }) => new PublicWorldUseCase(publicWorldRepository)).singleton(),
    profileRepository: asValue(profileRepository),
    profileUseCase: asFunction(({ profileRepository }) => new ProfileUseCase(profileRepository)).singleton(),
    authRepository: asValue(authRepository),
    authUseCase: asFunction(({ authRepository }) => new AuthUseCase(authRepository)).singleton(),
    signupRepository: asValue(signupRepository),
    signupUseCase: asFunction(({ signupRepository }) => new SignupUseCase(signupRepository)).singleton(),
    mediaRepository: asFunction(() => new HttpMediaRepository()).singleton(),
    mediaUseCase: asFunction(({ mediaRepository }) => new MediaUseCase(mediaRepository)).singleton(),
    manuscriptRepository: asFunction(() => new HttpManuscriptRepository()).singleton(),
    manuscriptUseCase: asFunction(({ manuscriptRepository }) => new ManuscriptUseCase(manuscriptRepository)).singleton(),
    episodeRepository: asFunction(() => new HttpEpisodeRepository()).singleton(),
    episodeUseCase: asFunction(({ episodeRepository }) => new EpisodeUseCase(episodeRepository)).singleton(),
    episodeCommentRepository: asFunction(() => new HttpEpisodeCommentRepository()).singleton(),
    episodeCommentUseCase: asFunction(({ episodeCommentRepository }) => new EpisodeCommentUseCase(episodeCommentRepository)).singleton(),
    workNoticeRepository: asFunction(() => new HttpWorkNoticeRepository()).singleton(),
    workNoticeUseCase: asFunction(({ workNoticeRepository }) => new WorkNoticeUseCase(workNoticeRepository)).singleton(),
    // 메모리 데모 작품(`--mode mockup`·테스트)의 소식. 실제 작품은 위 HTTP 저장소를 쓰고, 이 저장소는 서버에 저장하지 않는다.
    demoWorkNoticeUseCase: asFunction(() => new WorkNoticeUseCase(new InMemoryWorkNoticeRepository())).singleton(),
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
    accountUseCase: asFunction(({ workRepository, worldRepository, workInterestRepository, adminRepository }) => new AccountUseCase(workRepository, worldRepository, workInterestRepository, adminRepository)).singleton(),
    chatRepository: asFunction(({ mockDb }) => new InMemoryChatRepository(mockDb)).singleton(),
    chatUseCase: asFunction(({ workRepository, readingRepository, chatRepository }) => new ChatUseCase(workRepository, readingRepository, chatRepository)).singleton(),
    inboxUseCase: asFunction(({ workRepository, feedbackRepository }) => new InboxUseCase(workRepository, feedbackRepository)).singleton(),
    libraryUseCase: asFunction(({ workRepository, worldRepository, feedbackRepository, workInterestRepository, readingRecordRepository }) => new LibraryUseCase(workRepository, worldRepository, feedbackRepository, workInterestRepository, readingRecordRepository)).singleton(),
    creditUseCase: asFunction(({ creditRepository }) => new CreditUseCase(creditRepository)).singleton(),
    creditLedgerRepository: asFunction(() => new HttpCreditLedgerRepository()).singleton(),
    creditLedgerUseCase: asFunction(({ creditLedgerRepository }) => new CreditLedgerUseCase(creditLedgerRepository)).singleton(),
    withdrawalRepository: asFunction(() => new HttpWithdrawalRepository()).singleton(),
    withdrawalUseCase: asFunction(({ withdrawalRepository }) => new WithdrawalUseCase(withdrawalRepository)).singleton(),
    readingUseCase: asFunction(({ workRepository, readingRepository, readingRecordRepository, workSearchRepository, workLikeRepository }) => new ReadingUseCase(workRepository, readingRepository, readingRecordRepository, workSearchRepository, workLikeRepository)).singleton(),
    feedbackUseCase: asFunction(({ workRepository, feedbackRepository, adminRepository, feedbackReportUseCase }) => new FeedbackUseCase(workRepository, feedbackRepository, adminRepository, feedbackReportUseCase)).singleton(),
    forkUseCase: asFunction(({ workRepository }) => new ForkUseCase(workRepository)).singleton(),
    studioUseCase: asFunction(({ workRepository, creditRepository, feedbackRepository, worldRepository }) => new StudioUseCase(workRepository, creditRepository, feedbackRepository, worldRepository)).singleton(),
    shellUseCase: asFunction(({ notificationRepository, feedbackRepository }) => new ShellUseCase(notificationRepository, feedbackRepository)).singleton(),
  })
}
