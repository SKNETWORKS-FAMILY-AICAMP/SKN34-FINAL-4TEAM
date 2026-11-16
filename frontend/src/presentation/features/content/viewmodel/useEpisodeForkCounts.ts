import { useEffect, useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'

/**
 * 이 작품에서 갈라진 공개 포크 수를 분기 기준 회차별로 읽는다. 소설 상세의 회차별 포크 수와 같은 작품 목록(ReadingUseCase)이다.
 * 불러오는 중이거나 읽지 못하면 undefined라 화면이 수를 감춘다(0편으로 채우지 않는다).
 */
export function useEpisodeForkCounts(workId: string, reading: Pick<ReadingUseCase, 'forkCountsByEpisode'> = appContainer.resolve('readingUseCase')) {
  const [loaded, setLoaded] = useState<{ id: string; counts: Record<number, number> }>()
  useEffect(() => {
    let current = true
    reading.forkCountsByEpisode(workId).then(
      (counts) => { if (current) setLoaded({ id: workId, counts }) },
      () => {}, // 읽지 못하면 수를 감춘다. 회차 목록과 수정하기는 그대로 쓸 수 있다.
    )
    return () => { current = false }
  }, [reading, workId])
  return loaded?.id === workId ? loaded.counts : undefined
}
