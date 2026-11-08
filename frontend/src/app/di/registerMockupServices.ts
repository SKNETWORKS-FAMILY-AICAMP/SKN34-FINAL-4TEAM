import { asValue } from 'awilix/browser'

import { createMockupWorldStudioRepository, createMockupWritingRepository, mockupAuthRepository, mockupNotificationRepository } from '../../data/mock/mockupRepositories'
import { HttpEpisodeRepository } from '../../data/content/HttpEpisodeRepository'
import { InMemoryStoryPlanRepository } from '../../data/plans/InMemoryStoryPlanRepository'
import { EpisodeUseCase } from '../../domain/usecases/EpisodeUseCase'
import { AuthUseCase } from '../../domain/usecases/AuthUseCase'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import { ShellUseCase } from '../../domain/usecases/ShellUseCase'
import { StoryPlanUseCase } from '../../domain/usecases/StoryPlanUseCase'
import { WorldStudioUseCase } from '../../domain/usecases/WorldStudioUseCase'
import type { AppContainer } from './types'

/** `--mode mockup` 발표용 단일 HTML: 서버 호출 대신 메모리 대역을 덮어씁니다. 새로 고치면 초기화됩니다. */
export function registerMockupServices(container: AppContainer) {
  const { workRepository, readingRepository, feedbackRepository } = container.cradle
  // 시연 ①의 작품 목록·집필·저장·발행만 메모리로 바꾸고, 나머지 서버 원고 기능은 실패 안내를 그대로 보입니다.
  const episodeRepository = Object.assign(new HttpEpisodeRepository(), createMockupWritingRepository())
  container.register({
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
  })
}
