/**
 * 집필 AI 채팅 첨부(#617). 한 메시지에 3개까지, 이미지는 PNG·JPEG·WEBP(GIF는 AI가 거절한다), 텍스트는 .txt·.md이고 파일은 5MB 이하다.
 * 텍스트 20,000자·UTF-8 검사는 읽은 뒤에 한다(`readAttachments`). 서버(Content·AI)가 같은 한도를 다시 확인한다.
 */
export type AttachmentMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'text/plain' | 'text/markdown'
/** 요청 본문(`attachments`)의 첨부 하나. data는 Base64(data URL 접두어 없음)다. */
export type ChatAttachmentPayload = { name: string; mediaType: AttachmentMediaType; data: string }
/** 대화 기록에 남는 첨부 표시: 이름과 종류뿐이다(원본은 보낸 턴에서만 쓴다). */
export type ChatTurnAttachment = { name: string; kind: 'image' | 'text' }
export type AttachmentCheck = { name: string; mediaType: AttachmentMediaType } | string

export const ATTACHMENT_MAX = 3
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const TEXT_MAX_CHARS = 20_000

const IMAGES = new Set<string>(['image/png', 'image/jpeg', 'image/webp'])
const TEXTS: Record<string, AttachmentMediaType> = { txt: 'text/plain', md: 'text/markdown' }

export const attachmentKind = (mediaType: AttachmentMediaType): ChatTurnAttachment['kind'] => (IMAGES.has(mediaType) ? 'image' : 'text')

/**
 * 고른 파일 하나가 첨부할 수 있는지 판정한다. count는 지금 고른 개수다. 허용이면 { name, mediaType }, 거절이면 화면에 보일 이유 문구(파일 이름 포함)다.
 * 이미지는 브라우저가 알려 준 형식으로, 텍스트는 확장자로 정한다(Windows는 .md의 type이 빈 문자열일 수 있다).
 */
export function checkAttachment(file: Pick<File, 'name' | 'type' | 'size'>, count: number): AttachmentCheck {
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : ''
  const mediaType = IMAGES.has(file.type) ? file.type as AttachmentMediaType : file.type.startsWith('image/') ? undefined : TEXTS[extension]
  if (!mediaType) return `${file.name}: 지원하지 않는 형식이에요. PNG·JPEG·WEBP 이미지와 .txt·.md 텍스트 파일만 첨부할 수 있어요.`
  if (file.size > IMAGE_MAX_BYTES) return `${file.name}: 5MB 이하 파일만 첨부할 수 있어요.`
  if (count >= ATTACHMENT_MAX) return `${file.name}: 한 메시지에 ${ATTACHMENT_MAX}개까지만 첨부할 수 있어요.`
  return { name: file.name, mediaType }
}
