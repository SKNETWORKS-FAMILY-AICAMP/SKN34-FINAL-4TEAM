import { vi } from 'vitest'

import { appContainer } from '../app/appContainer'
import { ReadingUseCase } from '../domain/usecases/ReadingUseCase'

/**
 * 렌더·통합 테스트용: 컨테이너의 서버 검색 저장소가 Content 없이 메모리 시드(목업 검색·정렬 규칙)로 답하게 한다.
 * HTTP 계약·응답 변환은 data/domain 단위 테스트가 맡고, 여기서는 화면 조립만 확인한다. 복원은 vi.restoreAllMocks()다.
 */
export function stubWorkSearch() {
  const { workRepository, readingRepository, readingRecordRepository, workSearchRepository } = appContainer.cradle
  const memory = new ReadingUseCase(workRepository, readingRepository, readingRecordRepository)
  vi.spyOn(workSearchRepository, 'search').mockImplementation(async (query) => (await memory.findWorks(query)).list)
  vi.spyOn(workSearchRepository, 'ranking').mockImplementation(async (kind) => {
    const home = await memory.getHome(null, '추천')
    return kind === 'top' ? home.top10 : home.rising
  })
  vi.spyOn(workSearchRepository, 'recordView').mockResolvedValue(undefined)
}
