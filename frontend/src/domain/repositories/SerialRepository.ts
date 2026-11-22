import type { OpinionRequest, SerialBoardRecord, SerialBoardView, SerialSettings } from '../entities/aiSerial'

/** AI 자율 연재 저장소 계약([계약](../../../../docs/design/ai-serial-contract.md)). 서버 구현은 모두 Content 공개 API다. */
export interface SerialRepository {
  /** 소유자: 설정. */
  settings(workId: string, signal?: AbortSignal): Promise<SerialSettings>
  /** 소유자: 설정 저장(응답 본문은 쓰지 않는다: 호출 측이 다시 읽는다). */
  saveSettings(workId: string, settings: SerialSettings, signal?: AbortSignal): Promise<void>
  /** 소유자: 열린 게시판을 지금 마감·실행하도록 요청한다(202, 실행은 서버가 뒤에서 한다). */
  run(workId: string, signal?: AbortSignal): Promise<void>
  /** 소유자: 게시판 기록(최신순, 최대 50). */
  boards(workId: string, signal?: AbortSignal): Promise<SerialBoardRecord[]>
  /** 누구나(공개 작품): 열린 게시판과 의견. 로그인했으면 내 의견·내 투표도 온다. */
  board(workId: string, signal?: AbortSignal): Promise<SerialBoardView>
  /** 로그인: 의견 제출(게시판마다 하나). */
  submitOpinion(workId: string, request: OpinionRequest, signal?: AbortSignal): Promise<void>
  /** 로그인: 투표·다른 의견으로 옮기기(게시판마다 한 표). */
  vote(workId: string, opinionId: string, signal?: AbortSignal): Promise<void>
  cancelVote(workId: string, signal?: AbortSignal): Promise<void>
  /** 소유자: 악성 의견 숨김. */
  hideOpinion(workId: string, opinionId: string, signal?: AbortSignal): Promise<void>
}
