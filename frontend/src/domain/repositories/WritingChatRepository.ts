import type { ChatEvent, ChatHistory, ChatMessageInput, ChatSession } from '../entities/writingChat'

/** 집필 AI 채팅 세션 API(Content `/works/{id}/chat/sessions`). 저장은 AI 체크포인터가 하고 Content는 권한만 확인한다. */
export interface WritingChatRepository {
  sessions(workId: string, signal?: AbortSignal): Promise<ChatSession[]>
  open(workId: string, signal?: AbortSignal): Promise<string>
  history(workId: string, threadId: string, signal?: AbortSignal): Promise<ChatHistory>
  rename(workId: string, threadId: string, title: string): Promise<void>
  remove(workId: string, threadId: string): Promise<void>
  truncate(workId: string, threadId: string, index: number): Promise<void>
  /** SSE를 이벤트마다 onEvent로 넘긴다. editIndex가 있으면 그 메시지를 고쳐 다시 실행한다. HTTP 오류는 던진다. */
  send(workId: string, threadId: string, input: ChatMessageInput, onEvent: (event: ChatEvent) => void, signal?: AbortSignal, editIndex?: number): Promise<void>
}
