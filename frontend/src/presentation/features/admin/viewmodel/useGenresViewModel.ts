import { appContainer } from '../../../../app/appContainer'
import { moveCode, type GenreInput, type GenrePatch, type OperationsGenre } from '../../../../domain/entities/genre'
import type { OperationsGenreUseCase } from '../../../../domain/usecases/OperationsGenreUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

const quoted = (name: string) => `「${name}」`

/**
 * 장르 관리(DEC-56): 숨긴 장르를 포함한 전체 장르와 사용 수를 읽고, 추가·이름·아이콘·숨김·홈 노출·순서 변경을 요청합니다. `장르` 탭이 씁니다.
 * 변경 조치는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회를 한곳에서 합니다. 조치 키는 `genre:new`·`genre:<코드>`·`genre:order`입니다.
 * 조회 권한(작품 관리)이 없으면 목록이 null이라 화면이 실패 대신 필요한 권한을 안내합니다.
 */
export function useGenresViewModel(mutate: AdminMutate, useCase: OperationsGenreUseCase = appContainer.resolve('operationsGenreUseCase')) {
  const genres = useAsyncData(() => useCase.list(), [useCase])
  return {
    genres,
    create: (input: GenreInput) => mutate('genre:new', `${quoted(input.name.trim())} 장르를 추가했어요.`, () => useCase.create(input)),
    /** `message`는 성공했을 때 그 장르 줄에 알릴 문구(조치마다 다르다). */
    update: (genre: OperationsGenre, patch: GenrePatch, message: string) => mutate(`genre:${genre.code}`, message, () => useCase.update(genre.code, patch)),
    /** 현재 전체 코드 순서(`codes`)에서 한 칸 옮긴 순서를 저장한다. 더 옮길 수 없으면(맨 앞·맨 뒤) 보내지 않고 false다. */
    move: (codes: string[], genre: OperationsGenre, delta: -1 | 1) => {
      const next = moveCode(codes, genre.code, delta)
      return next ? mutate('genre:order', `${quoted(genre.name)} 장르를 ${delta < 0 ? '위로' : '아래로'} 옮겼어요.`, () => useCase.reorder(next)) : Promise.resolve(false)
    },
  }
}
