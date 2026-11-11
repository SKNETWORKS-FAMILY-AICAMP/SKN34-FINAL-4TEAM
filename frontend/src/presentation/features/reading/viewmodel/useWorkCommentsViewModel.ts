import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { bestComments, type CommentSort } from '../../../../domain/entities/episodeComment'
import type { EpisodeCommentUseCase } from '../../../../domain/usecases/EpisodeCommentUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 소설 상세의 작품 전체 댓글(읽기 전용). 서버 작품(canonical)만 Content에서 읽고, 데모 작품은 서버 댓글이 없어 읽지 않습니다.
 * 정렬은 화면 선택이라 refresh에 두어 이전 목록을 유지한 채 다시 읽고, 작품이 바뀌거나 로그인 상태가 바뀌면(useAsyncData가 범위에 포함) 목록을 감추고 다시 읽습니다.
 */
export function useWorkCommentsViewModel(workId: string, canonical: boolean, useCase: EpisodeCommentUseCase = appContainer.resolve('episodeCommentUseCase')) {
  const [sort, setSort] = useState<CommentSort>('latest')
  const { data, isError, retry } = useAsyncData(() => (canonical ? useCase.listByWork(workId, sort) : Promise.resolve(undefined)), [useCase, workId, canonical], [sort])
  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    comments: data,
    best: data ? bestComments(data) : [],
    isError, retry, sort, setSort,
  }
}
