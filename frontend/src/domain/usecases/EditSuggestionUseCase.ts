import { editedTextError, reasonError, suggestionInputError, type EditSuggestion } from '../entities/editSuggestion'
import type { EditSuggestionRepository } from '../repositories/EditSuggestionRepository'

/** 입력이 계약을 어기면 저장소를 부르기 전에 안내 문구로 던진다. */
function ensure(error: string | null) {
  if (error) throw new Error(error)
}

/** 실제 작품(Content) 수정 제안: 독자의 등록·내 제안 목록과 작가의 편집안 저장·승인·거절·보류. */
export class EditSuggestionUseCase {
  private readonly repository: EditSuggestionRepository
  constructor(repository: EditSuggestionRepository) {
    this.repository = repository
  }

  /** 앞뒤 공백을 지운 문장을 보낸다. 사유가 비면 생략한다. */
  async propose(workId: string, n: number, { beforeText, afterText, reason = '' }: { beforeText: string; afterText: string; reason?: string }) {
    ensure(suggestionInputError(beforeText, afterText, reason))
    const text = { beforeText: beforeText.trim(), afterText: afterText.trim() }
    return this.repository.create(workId, n, reason.trim() ? { ...text, reason: reason.trim() } : text)
  }

  mine() { return this.repository.mine() }

  inbox() { return this.repository.inbox() }

  async saveEditedText(s: EditSuggestion, text: string) {
    ensure(editedTextError(text))
    return this.repository.saveEditedText(s.workId, s.id, text.trim())
  }

  /** 승인과 초안 반영. 결과는 응답의 applyResult·applyFailure로 알린다(실패해도 승인은 기록됨). */
  approve(s: EditSuggestion) { return this.repository.approve(s.workId, s.id) }

  async reject(s: EditSuggestion, reason: string) {
    ensure(reasonError(reason))
    return this.repository.reject(s.workId, s.id, reason.trim() || undefined)
  }

  hold(s: EditSuggestion) { return this.repository.hold(s.workId, s.id) }
}
