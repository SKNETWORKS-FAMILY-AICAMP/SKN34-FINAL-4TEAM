import type { EditSuggestion } from '../entities/editSuggestion'

/** 수정 제안 저장소 계약([기능 24](../../../../docs/design/feedback-report-suggestion-contract.md)). 모든 호출은 Content 공개 API다. */
export interface EditSuggestionRepository {
  create(workId: string, episode: number, input: { beforeText: string; afterText: string; reason?: string }): Promise<EditSuggestion>
  /** 내가 올린 제안(최신순) */
  mine(): Promise<EditSuggestion[]>
  /** 내가 소유한 작품들의 제안(최신순). workId를 주면 서버가 그 작품 것만 준다(남의 작품이면 빈 목록). */
  inbox(workId?: string): Promise<EditSuggestion[]>
  /** 소유자가 편집안을 저장한다. 원래 고친 문장은 보존된다. */
  saveEditedText(workId: string, id: string, editedText: string): Promise<EditSuggestion>
  /** 승인과 초안 반영을 요청한다. 응답의 applyResult가 반영 결과이고, 기준 발행본이 바뀌었으면 409로 던진다. 발행은 하지 않는다. */
  approve(workId: string, id: string): Promise<EditSuggestion>
  reject(workId: string, id: string, reason?: string): Promise<EditSuggestion>
  hold(workId: string, id: string): Promise<EditSuggestion>
}
