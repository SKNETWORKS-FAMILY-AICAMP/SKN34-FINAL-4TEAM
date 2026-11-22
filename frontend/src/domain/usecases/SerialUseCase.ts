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

  /** 저장 응답 모양에 기대지 않고, 저장이 성공하면 서버가 저장한 값을 다시 읽어 돌려준다. */
  async saveSettings(workId: string, settings: SerialSettings, signal?: AbortSignal) {
    const error = serialSettingsError(settings)
    if (error) throw new Error(error)
    await this.repository.saveSettings(workId, serialSettingsInput(settings), signal)
    return this.repository.settings(workId, signal)
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
