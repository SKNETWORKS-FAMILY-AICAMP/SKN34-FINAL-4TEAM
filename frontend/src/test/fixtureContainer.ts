import { asValue } from 'awilix/browser'

import { createAppContainer } from '../app/di/container'
import { createFixtureDb } from '../data/mock/fixtureDb'
import { InMemoryEventRepository } from '../data/mock/InMemoryEventRepository'
import { InMemoryNoticeRepository } from '../data/mock/InMemoryNoticeRepository'
import { InMemoryOperationsWorkRepository } from '../data/mock/InMemoryOperationsWorkRepository'
import { InMemoryReadingRecordRepository, InMemorySupportInquiryRepository, InMemoryWorkRepository } from '../data/mock/InMemoryRepositories'
import { InMemoryWorkInterestRepository } from '../data/mock/InMemoryWorkInterestRepository'
import { mockupFeedbackReportRepository } from '../data/mock/mockupRepositories'

/** 시드 작품과 메모리 Work·독서 기록·관심 작품·공지·고객지원 문의·운영 이벤트·운영 작품 저장소를 명시 연결한 격리 컨테이너. 테스트 전용이며 production DI는 이를 쓰지 않는다. */
export function createFixtureContainer() {
  const db = createFixtureDb(), container = createAppContainer()
  container.register({
    mockDb: asValue(db),
    workRepository: asValue(new InMemoryWorkRepository(db)),
    readingRecordRepository: asValue(new InMemoryReadingRecordRepository(db)),
    workInterestRepository: asValue(new InMemoryWorkInterestRepository()),
    noticeRepository: asValue(new InMemoryNoticeRepository()),
    supportInquiryRepository: asValue(new InMemorySupportInquiryRepository(db)),
    eventRepository: asValue(new InMemoryEventRepository()),
    operationsWorkRepository: asValue(new InMemoryOperationsWorkRepository(db)),
    // 정본 작품이 없는 격리 컨테이너라 제보 목록은 비어 있고, 제보 화면을 확인하는 테스트는 저장소 메서드를 spyOn으로 바꾼다.
    feedbackReportRepository: asValue(mockupFeedbackReportRepository),
  })
  return container
}
