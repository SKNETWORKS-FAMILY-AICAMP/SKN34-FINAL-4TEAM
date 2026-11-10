import { asValue } from 'awilix/browser'

import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryNoticeRepository } from '../../data/mock/InMemoryNoticeRepository'
import { InMemoryReadingRecordRepository, InMemorySupportInquiryRepository, InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { InMemoryWorkInterestRepository } from '../../data/mock/InMemoryWorkInterestRepository'
import { InMemoryEventRepository } from '../../data/mock/InMemoryEventRepository'
import { InMemoryAdminActivityRepository } from '../../data/mock/InMemoryAdminActivityRepository'
import { InMemoryOperationsWorkRepository } from '../../data/mock/InMemoryOperationsWorkRepository'
import { seedNotices } from '../../data/mock/seed'
import { createMockupManuscriptRepository, createMockupWorldStudioRepository, createMockupWritingRepository, mockupAuthRepository, mockupNotificationRepository, mockupUnsupportedMedia } from '../../data/mock/mockupRepositories'
import { HttpEpisodeRepository } from '../../data/content/HttpEpisodeRepository'
import { HttpMediaRepository } from '../../data/content/HttpMediaRepository'
import { InMemoryStoryPlanRepository } from '../../data/plans/InMemoryStoryPlanRepository'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { AuthUseCase } from '../../domain/usecases/AuthUseCase'
import { EventUseCase } from '../../domain/usecases/EventUseCase'
import { ManuscriptUseCase } from '../../domain/usecases/ManuscriptUseCase'
import { MediaUseCase } from '../../domain/usecases/MediaUseCase'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import { ShellUseCase } from '../../domain/usecases/ShellUseCase'
import { StoryPlanUseCase } from '../../domain/usecases/StoryPlanUseCase'
import { WorldStudioUseCase } from '../../domain/usecases/WorldStudioUseCase'
import type { AppContainer } from './types'

/** `--mode mockup` 발표용 단일 HTML: 서버 호출 대신 메모리 대역을 덮어씁니다. 새로 고치면 초기화됩니다. */
export function registerMockupServices(container: AppContainer) {
  // 서버가 없는 발표용 빌드이므로 production의 Content HTTP 작품 저장소 대신 시드 메모리 DB를 명시 연결한다(통합 테스트의 fixtureApp과 같다).
  const mockDb = createFixtureDb()
  // 관심 작품·독서 기록도 서버 대신 메모리에 둔다(use case는 이 저장소들을 늦게 조회하므로 다시 등록하지 않는다).
  container.register({ mockDb: asValue(mockDb), workRepository: asValue(new InMemoryWorkRepository(mockDb)), supportInquiryRepository: asValue(new InMemorySupportInquiryRepository(mockDb)), workInterestRepository: asValue(new InMemoryWorkInterestRepository()), readingRecordRepository: asValue(new InMemoryReadingRecordRepository(mockDb)) })
  const { workRepository, readingRepository, readingRecordRepository, feedbackRepository } = container.cradle
  // 시연 ①의 작품 목록·집필·저장·발행만 메모리로 바꾸고, 나머지 서버 원고 기능은 실패 안내를 그대로 보입니다.
  const episodeRepository = Object.assign(new HttpEpisodeRepository(), createMockupWritingRepository())
  const eventRepository = new InMemoryEventRepository()
  const mediaRepository = Object.assign(new HttpMediaRepository(), mockupUnsupportedMedia)
  const manuscriptRepository = createMockupManuscriptRepository(episodeRepository)
  container.register({
    // 운영 이벤트 API 대신 메모리에만 등록·공개합니다.
    eventRepository: asValue(eventRepository),
    eventUseCase: asValue(new EventUseCase(eventRepository)),
    // 운영 작품 API 대신 데모 작품 DB를 운영 작품 형태로 보여 주고, 운영 제한은 데모 작품의 공개 제외로 반영합니다.
    operationsWorkRepository: asValue(new InMemoryOperationsWorkRepository(mockDb)),
    // 운영 활동 기록 API 대신 데모 관리자 화면이 쌓은 데모 조치를 활동 기록 형태로 보여 줍니다.
    adminActivityRepository: asValue(new InMemoryAdminActivityRepository(mockDb)),
    // 검색 저장소를 주지 않아 홈 순위·검색은 서버 호출 없이 메모리 데모를 유지하고, 독서 기록도 mockDb.progress 메모리입니다.
    readingUseCase: asValue(new ReadingUseCase(workRepository, readingRepository, readingRecordRepository)),
    episodeRepository: asValue(episodeRepository),
    episodeUseCase: asValue(new EpisodeUseCase(episodeRepository)),
    // 가져오기·EPUB/발행본 내보내기·첨부 이름 변경·회차 이미지 관리는 데모 미지원 오류로 답하고(성공을 흉내 내지 않음), 집필실 TXT 초안 내보내기만 메모리 원고로 만듭니다.
    mediaRepository: asValue(mediaRepository),
    mediaUseCase: asValue(new MediaUseCase(mediaRepository)),
    manuscriptRepository: asValue(manuscriptRepository),
    manuscriptUseCase: asValue(new ManuscriptUseCase(manuscriptRepository)),
    authRepository: asValue(mockupAuthRepository),
    authUseCase: asValue(new AuthUseCase(mockupAuthRepository)),
    notificationRepository: asValue(mockupNotificationRepository),
    shellUseCase: asValue(new ShellUseCase(mockupNotificationRepository, feedbackRepository)),
    worldStudioUseCase: asValue(new WorldStudioUseCase(createMockupWorldStudioRepository())),
    storyPlanUseCase: asValue(new StoryPlanUseCase(new InMemoryStoryPlanRepository(workRepository))),
    openNotificationStream: asValue(() => () => {}),
    // 공지는 관리자 탭에서 쓰면 /me/notice에 보이는 메모리 저장소. 기존 목업 공지 4건으로 시작합니다.
    noticeRepository: asValue(new InMemoryNoticeRepository(seedNotices())),
  })
}
