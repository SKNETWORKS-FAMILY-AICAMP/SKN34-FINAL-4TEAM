import { vi } from 'vitest'

import { appContainer } from '../app/appContainer'
import { ReadingUseCase } from '../domain/usecases/ReadingUseCase'

/** 스텁이 돌려주는 서버 계산 시각: 한국시간 14:07 */
export const STUB_RANKED_AT = new Date('2026-11-10T05:07:00Z')

/**
 * 렌더·통합 테스트용: 컨테이너의 서버 검색 저장소가 Content 없이 메모리 시드(목업 검색·정렬 규칙)로 답하게 한다.
 * 기간별 랭킹은 기간과 무관하게 메모리 정렬을 limit(기본 10)까지 잘라 주고 계산 시각은 STUB_RANKED_AT이다.
 * HTTP 계약·응답 변환은 data/domain 단위 테스트가 맡고, 여기서는 화면 조립만 확인한다. 복원은 vi.restoreAllMocks()다.
 */
export function stubWorkSearch() {
  const { workRepository, readingRepository, readingRecordRepository, workSearchRepository } = appContainer.cradle
  const memory = new ReadingUseCase(workRepository, readingRepository, readingRecordRepository)
  vi.spyOn(workSearchRepository, 'search').mockImplementation(async (query) => (await memory.findWorks(query)).list)
  vi.spyOn(workSearchRepository, 'rankings').mockImplementation(async ({ kind, period = 'day', type, limit = 10 }) => {
    const { items } = await memory.rankWorks({ t: type === 'original' ? 'orig' : type === 'fork' ? 'if' : 'all', kind, period })
    return { items: items.slice(0, limit), computedAt: STUB_RANKED_AT }
  })
  vi.spyOn(workSearchRepository, 'recordView').mockResolvedValue(undefined)
}
