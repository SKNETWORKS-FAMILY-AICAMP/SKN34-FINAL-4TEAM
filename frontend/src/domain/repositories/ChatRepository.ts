import type { CharacterChat, ChatLine } from '../entities/chat'

export interface ChatRepository {
  /** 아직 운영팀이 정한 목록이 없으면 null */
  listChats(): Promise<CharacterChat[] | null>
  saveChats(chats: CharacterChat[]): Promise<void>
  getLog(key: string): Promise<ChatLine[] | undefined>
  saveLog(key: string, log: ChatLine[]): Promise<void>
}
