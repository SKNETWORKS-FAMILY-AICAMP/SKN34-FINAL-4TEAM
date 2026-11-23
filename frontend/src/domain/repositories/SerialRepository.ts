import type { ProposalRequest, SerialBoardRecord, SerialBoardView, SerialScheduleInput, SerialSettings } from '../entities/aiSerial'

/** AI 자율 연재 저장소 계약([계약](../../../../docs/design/ai-serial-contract.md)). 서버 구현은 모두 Content 공개 API다. */
export interface SerialRepository {
  /** 소유자: 설정. */
  settings(workId: string, signal?: AbortSignal): Promise<SerialSettings>
  /** 소유자: 요일·시각·방향 저장(켜짐은 보내지 않는다. 응답 본문은 쓰지 않는다: 호출 측이 다시 읽는다). */
  saveSettings(workId: string, settings: SerialScheduleInput, signal?: AbortSignal): Promise<void>
  /** 소유자: 열린 게시판을 지금 마감·실행하도록 요청한다(202, 실행은 서버가 뒤에서 한다). */
  run(workId: string, signal?: AbortSignal): Promise<void>
  /** 소유자: 게시판 기록(최신순, 최대 50). */
  boards(workId: string, signal?: AbortSignal): Promise<SerialBoardRecord[]>
  /** 누구나(공개 작품): '다음 회차' 게시판(AI 자율 집필 여부·선택지·제안 글). 로그인했으면 내 투표·내 글·내 추천도 온다. */
  board(workId: string, signal?: AbortSignal): Promise<SerialBoardView>
  /** 로그인: 선택지 투표·다른 선택지로 옮기기(게시판마다 한 표). */
  vote(workId: string, choiceId: string, signal?: AbortSignal): Promise<void>
  cancelVote(workId: string, signal?: AbortSignal): Promise<void>
  /** 로그인: 제안 글 제출(개수 제한 없음). 시뮬레이션은 서버가 AI 장면 미리보기를 만들어 붙인다. */
  submitProposal(workId: string, request: ProposalRequest, signal?: AbortSignal): Promise<void>
  /** 로그인: 제안 글 추천·추천 취소(글마다 회원당 1회). */
  likeProposal(workId: string, proposalId: string, signal?: AbortSignal): Promise<void>
  unlikeProposal(workId: string, proposalId: string, signal?: AbortSignal): Promise<void>
  /** 소유자: 제안 글 숨김. */
  hideProposal(workId: string, proposalId: string, signal?: AbortSignal): Promise<void>
}
