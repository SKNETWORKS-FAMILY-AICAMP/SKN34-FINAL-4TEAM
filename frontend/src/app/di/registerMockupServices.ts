import { asValue } from 'awilix/browser'

import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryNoticeRepository } from '../../data/mock/InMemoryNoticeRepository'
import { InMemorySupportInquiryRepository, InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { InMemoryEventRepository } from '../../data/mock/InMemoryEventRepository'
import { InMemoryOperationsWorkRepository } from '../../data/mock/InMemoryOperationsWorkRepository'
import { seedNotices } from '../../data/mock/seed'
import { createMockupWorldStudioRepository, createMockupWritingRepository, mockupAuthRepository, mockupNotificationRepository } from '../../data/mock/mockupRepositories'
import { HttpEpisodeRepository } from '../../data/content/HttpEpisodeRepository'
import { InMemoryStoryPlanRepository } from '../../data/plans/InMemoryStoryPlanRepository'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { AuthUseCase } from '../../domain/usecases/AuthUseCase'
import { EventUseCase } from '../../domain/usecases/EventUseCase'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import { ShellUseCase } from '../../domain/usecases/ShellUseCase'
import { StoryPlanUseCase } from '../../domain/usecases/StoryPlanUseCase'
import { WorldStudioUseCase } from '../../domain/usecases/WorldStudioUseCase'
import type { AppContainer } from './types'

/** `--mode mockup` 발표용 단일 HTML: 서버 호출 대신 메모리 대역을 덮어씁니다. 새로 고치면 초기화됩니다. */
export function registerMockupServices(container: AppContainer) {
  // 서버가 없는 발표용 빌드이므로 production의 Content HTTP 작품 저장소 대신 시드 메모리 DB를 명시 연결한다(통합 테스트의 fixtureApp과 같다).
  const mockDb = createFixtureDb()
  container.register({ mockDb: asValue(mockDb), workRepository: asValue(new InMemoryWorkRepository(mockDb)), supportInquiryRepository: asValue(new InMemorySupportInquiryRepository(mockDb)) })
  const { workRepository, readingRepository, feedbackRepository } = container.cradle
  // 시연 ①의 작품 목록·집필·저장·발행만 메모리로 바꾸고, 나머지 서버 원고 기능은 실패 안내를 그대로 보입니다.
  const episodeRepository = Object.assign(new HttpEpisodeRepository(), createMockupWritingRepository())
  const eventRepository = new InMemoryEventRepository()
  container.register({
    // 운영 이벤트 API 대신 메모리에만 등록·공개합니다.
    eventRepository: asValue(eventRepository),
    eventUseCase: asValue(new EventUseCase(eventRepository)),
    // 운영 작품 API 대신 데모 작품 DB를 운영 작품 형태로 보여 주고, 운영 제한은 데모 작품의 공개 제외로 반영합니다.
    operationsWorkRepository: asValue(new InMemoryOperationsWorkRepository(mockDb)),
    // 검색 저장소를 주지 않아 홈 순위·검색은 서버 호출 없이 메모리 데모를 유지합니다.
    readingUseCase: asValue(new ReadingUseCase(workRepository, readingRepository)),
    episodeRepository: asValue(episodeRepository),
    episodeUseCase: asValue(new EpisodeUseCase(episodeRepository)),
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
