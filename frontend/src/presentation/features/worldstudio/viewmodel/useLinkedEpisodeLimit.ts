import { useEffect, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'

/**
 * 연결된 소설의 현재 마지막 회차 번호(결정 5): 초안과 이어받은 원작 회차를 포함한 작품 회차 목록(`writingList`) 기준이고 회차가 없으면 0이다. 새 API 없이 기존 UseCase로 읽는다.
 * 소설이 연결되지 않았거나 회차 목록을 읽는 중·읽지 못했으면 undefined다: 그때는 상한 검사를 하지 않고 기존처럼 두며, 없는 회차라는 표시 문구도 지어내지 않는다.
 * 세계관 ViewModel이 쓰므로 redux 없이 동작하는 effect로 읽는다(`useAsyncData`는 store가 필요하다). 소설이 바뀌거나 연결이 풀리거나 화면을 떠나면 이전 요청을 취소하고,
 * 조회를 새로 시작할 때 이전 결과를 버려 이번 조회가 성공한 값만 돌려준다(연결을 풀었다 같은 소설을 다시 연결해도 옛 상한을 돌려주지 않는다).
 * [reload]는 호출자가 세계관을 서버에서 다시 읽을 때 올리는 신호다: 같은 소설이어도 그 사이 회차가 늘었을 수 있어 회차 수도 다시 읽는다(값이 같으면 다시 읽지 않는다).
 */
export function useLinkedEpisodeLimit(linkedWorkId: string | null, reload?: number) {
  const [read, setRead] = useState<{ workId: string; limit: number }>()
  useEffect(() => {
    setRead(undefined)
    if (!linkedWorkId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const rows = await appContainer.resolve('episodeUseCase').writingList(linkedWorkId, controller.signal)
        if (!controller.signal.aborted) setRead({ workId: linkedWorkId, limit: Math.max(0, ...rows.map((row) => row.number)) })
      } catch {
        // 읽지 못하면 상한 없이 둔다(검사도 표시 문구도 만들지 않는다).
      }
    })()
    return () => controller.abort()
  }, [linkedWorkId, reload])
  return linkedWorkId && read?.workId === linkedWorkId ? read.limit : undefined
}
