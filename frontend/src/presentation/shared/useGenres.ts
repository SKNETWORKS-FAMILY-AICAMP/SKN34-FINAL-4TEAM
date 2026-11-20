import { appContainer } from '../../app/appContainer'
import type { GenreUseCase } from '../../domain/usecases/GenreUseCase'
import { useAsyncData } from './useAsyncData'

/**
 * 작품·세계관 장르 선택지와 칩이 쓰는 공개 장르 목록(활성 장르, 표시 순서, DEC-56). 서버가 정본이라 읽는 동안·읽지 못했을 때는 `data`가 없고,
 * 화면은 빈 목록으로 채우지 않고 `isError`면 실패 안내와 `retry`(다시 불러오기)를 보인다.
 */
export function useGenres(useCase: GenreUseCase = appContainer.resolve('genreUseCase')) {
  return useAsyncData((signal) => useCase.list(signal), [useCase])
}
