/** 목업 S.admin.characterChats: 운영팀이 연 캐릭터챗 (작품·인물 단위) */
export type CharacterChat = { id: string; workId: string; character: string; enabled: boolean }
/** 목업 S.chat[key]: [말한 사람, 내용, 근거] */
export type ChatLine = [who: string, text: string, ev?: string]
