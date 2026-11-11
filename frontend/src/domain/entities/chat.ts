/** 목업 S.admin.characterChats: 운영팀이 연 캐릭터챗 (작품·인물 단위) */
export type CharacterChat = { id: string; workId: string; character: string; enabled: boolean }
/** 목업 S.chat[key]: [말한 사람, 내용, 근거] */
export type ChatLine = [who: string, text: string, ev?: string]

/** 공용 채팅 컴포넌트가 그리는 첨부 칩. 업로드 여부는 호출하는 화면이 정한다. */
export type ChatAttachment = { id: string; kind: 'image' | 'audio'; name: string }
/** 공용 채팅 메시지. 전송·저장·AI 호출은 이 타입이 아니라 화면의 ViewModel이 맡는다. */
export type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string; attachments?: ChatAttachment[] }
