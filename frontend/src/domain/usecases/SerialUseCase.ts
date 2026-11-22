import { opinionInputError, opinionRequest, serialSettingsError, serialSettingsInput, type OpinionInput, type SerialSettings } from '../entities/aiSerial'
import type { SerialRepository } from '../repositories/SerialRepository'

/** AI 자율 연재: 소유자의 설정·실행·기록과 독자의 의견·투표. 입력 검증이 던지는 예외는 저장소를 부르기 전의 안내 문구다. */
export class SerialUseCase {
  private readonly repository: SerialRepository
  constructor(repository: SerialRepository) {
    this.repository = repository
  }

  settings(workId: string, signal?: AbortSignal) {
    return this.repository.settings(workId, signal)
  }

  /**
   * 검증하고 다듬은 값을 저장(PUT)하고 그 값을 돌려준다. 저장 응답 모양에 기대지 않고, 서버 값을 다시 읽는 것은 호출 측이 따로 한다
   * (저장은 성공했는데 읽기만 실패한 것이 저장 실패로 보이지 않게).
   */
  async saveSettings(workId: string, settings: SerialSettings, signal?: AbortSignal) {
    const error = serialSettingsError(settings)
    if (error) throw new Error(error)
    const input = serialSettingsInput(settings)
    await this.repository.saveSettings(workId, input, signal)
    return input
  }

  run(workId: string, signal?: AbortSignal) {
    return this.repository.run(workId, signal)
  }

  boards(workId: string, signal?: AbortSignal) {
    return this.repository.boards(workId, signal)
  }

  board(workId: string, signal?: AbortSignal) {
    return this.repository.board(workId, signal)
  }

  async submitOpinion(workId: string, input: OpinionInput, signal?: AbortSignal) {
    const error = opinionInputError(input)
    if (error) throw new Error(error)
    return this.repository.submitOpinion(workId, opinionRequest(input), signal)
  }

  vote(workId: string, opinionId: string, signal?: AbortSignal) {
    return this.repository.vote(workId, opinionId, signal)
  }

  cancelVote(workId: string, signal?: AbortSignal) {
    return this.repository.cancelVote(workId, signal)
  }

  hideOpinion(workId: string, opinionId: string, signal?: AbortSignal) {
    return this.repository.hideOpinion(workId, opinionId, signal)
  }
}
