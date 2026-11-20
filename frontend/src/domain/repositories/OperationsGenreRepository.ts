import type { GenreInput, GenrePatch, OperationsGenre } from '../entities/genre'

/** 운영 장르 관리 API 계약(DEC-56). 관리자 Bearer와 works 권한으로 호출하며, 변경 응답은 쓰지 않고 화면이 목록을 다시 읽는다. */
export interface OperationsGenreRepository {
  /** 숨긴 장르를 포함한 전체 장르(표시 순서). */
  list(): Promise<OperationsGenre[]>
  create(input: GenreInput): Promise<void>
  update(code: string, patch: GenrePatch): Promise<void>
  /** 전체 코드를 한 번씩 담은 새 순서. 빠짐·중복·없는 코드는 서버가 거절한다. */
  reorder(codes: string[]): Promise<void>
}
