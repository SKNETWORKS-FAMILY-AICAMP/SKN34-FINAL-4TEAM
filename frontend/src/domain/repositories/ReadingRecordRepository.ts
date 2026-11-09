/**
 * 로그인 회원 한 명의 작품별 독서 기록(Content 서버 정본, docs/design/reading-management-contract.md).
 * 이어 읽기 위치는 최댓값이 아니라 가장 최근에 연 회차다.
 */
export type ReadingRecord = { workId: string; lastEpisode: number; readEpisodes: number[] }

export interface ReadingRecordRepository {
  /** 본인의 독서 기록. 가장 최근에 읽은 작품이 앞이고 읽은 회차는 오름차순이다. */
  list(signal?: AbortSignal): Promise<ReadingRecord[]>
  /** 공개 작품의 발행 회차를 열었다고 기록한다: 이어 읽기 위치를 그 회차로 옮기고 읽은 회차에 더한다(멱등). */
  record(workId: string, episode: number, signal?: AbortSignal): Promise<void>
  /** 한 작품의 이어 읽기 위치와 읽은 회차 기록을 지운다(멱등). */
  remove(workId: string, signal?: AbortSignal): Promise<void>
}
