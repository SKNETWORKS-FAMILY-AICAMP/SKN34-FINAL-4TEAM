import { asValue } from 'awilix/browser'

import { createAppContainer } from '../app/di/container'
import { createFixtureDb } from '../data/mock/fixtureDb'
import { InMemoryAdminActivityRepository } from '../data/mock/InMemoryAdminActivityRepository'
import { InMemoryEventRepository } from '../data/mock/InMemoryEventRepository'
import { InMemoryGenreRepository, InMemoryOperationsGenreRepository } from '../data/mock/InMemoryGenreRepositories'
import { InMemoryJobMonitorRepository, InMemoryLlmOpsRepository, InMemoryOperationsDashboardRepository } from '../data/mock/InMemoryLlmOpsRepositories'
import { InMemoryNoticeRepository } from '../data/mock/InMemoryNoticeRepository'
import { InMemoryOperationsCommentRepository } from '../data/mock/InMemoryOperationsCommentRepository'
import { InMemoryOperationsWorkRepository } from '../data/mock/InMemoryOperationsWorkRepository'
import { InMemoryPublicWorldRepository } from '../data/mock/InMemoryPublicWorldRepository'
import { InMemoryReadingRecordRepository, InMemorySupportInquiryRepository, InMemoryWorkRepository } from '../data/mock/InMemoryRepositories'
import { InMemoryWorkInterestRepository } from '../data/mock/InMemoryWorkInterestRepository'
import { mockupFeedbackReportRepository } from '../data/mock/mockupRepositories'
import type { SerialRepository } from '../domain/repositories/SerialRepository'

// 서버가 없는 격리 컨테이너라 의견 게시판은 '열린 게시판 없음'으로 답해, 정본 작품 화면이 네트워크 오류로 깨지지 않게 한다. 게시판을 확인하는 테스트는 serialUseCase를 대역으로 바꾼다.
const unsupported = async () => { throw new Error('데모에서는 지원하지 않아요.') }
const noSerialBoard: SerialRepository = {
  settings: unsupported, saveSettings: unsupported, run: unsupported, boards: unsupported, submitOpinion: unsupported, vote: unsupported, cancelVote: unsupported, hideOpinion: unsupported,
  board: async () => ({ board: null, opinions: [], myOpinionId: null, myVoteOpinionId: null, summary: null }),
}

/** 시드 작품과 메모리 Work·독서 기록·관심 작품·공지·고객지원 문의·운영 이벤트·운영 작품·운영 댓글·장르 목록·관리자 활동 기록·운영 대시보드·LLMOps·작업 감시 저장소를 명시 연결한 격리 컨테이너. 테스트 전용이며 production DI는 이를 쓰지 않는다. */
export function createFixtureContainer() {
  const db = createFixtureDb(), container = createAppContainer(), operationsGenres = new InMemoryOperationsGenreRepository()
  container.register({
    operationsGenreRepository: asValue(operationsGenres),
    genreRepository: asValue(new InMemoryGenreRepository(operationsGenres)),
    mockDb: asValue(db),
    workRepository: asValue(new InMemoryWorkRepository(db)),
    readingRecordRepository: asValue(new InMemoryReadingRecordRepository(db)),
    workInterestRepository: asValue(new InMemoryWorkInterestRepository()),
    noticeRepository: asValue(new InMemoryNoticeRepository()),
    supportInquiryRepository: asValue(new InMemorySupportInquiryRepository(db)),
    eventRepository: asValue(new InMemoryEventRepository()),
    operationsWorkRepository: asValue(new InMemoryOperationsWorkRepository(db)),
    operationsCommentRepository: asValue(new InMemoryOperationsCommentRepository(db)),
    adminActivityRepository: asValue(new InMemoryAdminActivityRepository(db)),
    operationsDashboardRepository: asValue(new InMemoryOperationsDashboardRepository()),
    llmOpsRepository: asValue(new InMemoryLlmOpsRepository()),
    jobMonitorRepository: asValue(new InMemoryJobMonitorRepository()),
    publicWorldRepository: asValue(new InMemoryPublicWorldRepository()),
    // 정본 작품이 없는 격리 컨테이너라 제보 목록은 비어 있고, 제보 화면을 확인하는 테스트는 저장소 메서드를 spyOn으로 바꾼다.
    feedbackReportRepository: asValue(mockupFeedbackReportRepository),
    serialRepository: asValue(noSerialBoard),
  })
  return container
}
