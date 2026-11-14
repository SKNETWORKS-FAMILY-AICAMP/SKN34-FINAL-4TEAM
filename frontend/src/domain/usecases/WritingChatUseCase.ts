import { cleanSimulation } from '../entities/characterSimulation'
import { cleanScene, type ChatEvent, type ChatMessageInput } from '../entities/writingChat'
import type { WritingChatRepository } from '../repositories/WritingChatRepository'

/** 집필 AI 채팅. 새 대화는 open으로 id를 받은 뒤 첫 메시지를 보내면 AI 체크포인터에 생긴다. */
export class WritingChatUseCase {
  private readonly repository: WritingChatRepository
  constructor(repository: WritingChatRepository) { this.repository = repository }
  sessions(workId: string, signal?: AbortSignal) { return this.repository.sessions(workId, signal) }
  open(workId: string, signal?: AbortSignal) { return this.repository.open(workId, signal) }
  history(workId: string, threadId: string, signal?: AbortSignal) { return this.repository.history(workId, threadId, signal) }
  rename(workId: string, threadId: string, title: string) {
    const trimmed = title.trim()
    if (!trimmed || trimmed.length > 100) return Promise.reject(new Error('대화 제목은 1~100자로 적어 주세요.'))
    return this.repository.rename(workId, threadId, trimmed)
  }
  remove(workId: string, threadId: string) { return this.repository.remove(workId, threadId) }
  truncate(workId: string, threadId: string, index: number) { return this.repository.truncate(workId, threadId, index) }
  async send(workId: string, threadId: string, input: ChatMessageInput, onEvent: (event: ChatEvent) => void, signal?: AbortSignal, editIndex?: number) {
    if ('request' in input && !input.request.trim()) throw new Error('보낼 내용을 적어 주세요.')
    return this.repository.send(workId, threadId, checked(input), onEvent, signal, editIndex)
  }
}

/** 시작 양식 값과 장면 조작(무대)을 서버 한도에 맞게 다듬는다. 그 밖의 요청·승인 응답은 그대로 간다. */
function checked(input: ChatMessageInput): ChatMessageInput {
  if ('request' in input && input.simulation) {
    if (input.operation !== 'character_simulation') throw new Error('시뮬레이션 시작은 시뮬레이션 기능으로만 보낼 수 있어요.')
    return { ...input, simulation: cleanSimulation(input.simulation) }
  }
  if ('resume' in input && input.resume.scene) return { ...input, resume: { ...input.resume, scene: cleanScene(input.resume.scene) } }
  return input
}
