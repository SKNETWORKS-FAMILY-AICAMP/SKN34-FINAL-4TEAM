import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { Work } from '../../../../domain/entities/content'
import type { Work as ReadingWork } from '../../../../domain/entities/work'
import { useAsyncData } from '../../../shared/useAsyncData'

/*
 * 세계관 ↔ 소설 1:1 연결(DEC-46)의 조회와 연결 동작. 연결은 초안 저장과 별개로 서버에 바로 적용되고, 해제는 작품 관리 화면이 맡는다.
 */

/**
 * 연결된 소설의 제목과 공개 여부(`/ifs` 모아 보기 링크가 공개 원작에만 열린다). 내 소설 목록에서 찾고 연결돼 있을 때만 읽는다(`title`이 없고 읽는 중도 아니면 읽지 못한 것이다).
 * 마법사 헤더의 상태 줄과 '소설 연결' 탭이 쓰고, 탭은 열 때만 읽는다(헤더 줄은 작성 모드에만 있다).
 * ponytail: 연결 직후에도 제목을 보이려고 내 소설 목록을 한 번 더 읽는다(연결 시트가 읽은 목록을 나눠 쓰지 않는다). 느려지면 작품 단건 조회로 바꾼다.
 */
export function useLinkedWork(linkedWorkId: string | null) {
  const works = useAsyncData<Work[] | null>((signal) => (linkedWorkId ? appContainer.resolve('episodeUseCase').list(signal) : Promise.resolve(null)), [linkedWorkId])
  const work = works.data?.find((item) => item.id === linkedWorkId)
  return { title: work?.title, isPublic: work?.visibility === 'public', isLoading: works.isLoading }
}

/**
 * 연결된 소설에서 갈라진 공개 Fork 목록(`ReadingUseCase.forksOf`, 새 API 없음). 연결된 소설이 없으면 읽지 않고 null이다.
 * 목록을 읽지 못하면 `isError`이고 `retry`로 다시 읽는다(빈 목록으로 채우지 않는다).
 */
export function useLinkedForks(linkedWorkId: string | null) {
  return useAsyncData<ReadingWork[] | null>(() => (linkedWorkId ? appContainer.resolve('readingUseCase').forksOf(linkedWorkId) : Promise.resolve(null)), [linkedWorkId])
}

/**
 * `소설 연결하기` 시트의 상태와 동작. 내 소설 목록은 시트를 열 때만 읽고, 아직 세계관에 연결되지 않은 소설(`free`)만 고를 수 있다.
 * 고르면 서버에 연결한 뒤 `onLinked`로 알리고 시트를 닫는다. 목록 조회·연결이 실패하면 서버가 준 이유를 그대로 알린다(`failed`, `problem`).
 */
export function useNovelLink(worldId: string | undefined, onLinked: (workId: string) => void) {
  const [open, setOpen] = useState(false)
  const [linking, setLinking] = useState(false)
  const [problem, setProblem] = useState('')
  const works = useAsyncData<Work[] | null>((signal) => (open ? appContainer.resolve('episodeUseCase').list(signal) : Promise.resolve(null)), [open])
  const link = async (work: Work) => {
    if (!worldId) return
    setLinking(true)
    setProblem('')
    try {
      await appContainer.resolve('episodeUseCase').linkWorldStudio(work.id, worldId)
      onLinked(work.id)
      setOpen(false)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : '소설을 연결하지 못했어요.')
    } finally {
      setLinking(false)
    }
  }
  return {
    open, linking, problem, link,
    openSheet: () => setOpen(true),
    close: () => { setOpen(false); setProblem('') },
    isLoading: works.isLoading,
    failed: !works.isLoading && !works.data,
    free: works.data?.filter((work) => !work.worldStudioId) ?? [],
    retry: works.retry,
  }
}
