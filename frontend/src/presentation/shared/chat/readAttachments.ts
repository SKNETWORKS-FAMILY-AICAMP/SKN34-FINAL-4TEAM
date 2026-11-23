import { attachmentKind, checkAttachment, TEXT_MAX_CHARS, type ChatAttachmentPayload } from '../../../domain/entities/chatAttachment'

/** 파일을 Base64(data URL 접두어 없이)로 읽는다. */
const base64Of = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1))
  reader.onerror = () => reject(new Error(`${file.name}: 파일을 읽지 못했어요.`))
  reader.readAsDataURL(file)
})

/**
 * 보낼 파일을 요청 본문의 첨부(이름·형식·Base64)로 읽는다. 고를 때 막은 한도(형식·크기)는 다시 확인하고, 읽은 뒤에야 알 수 있는
 * 텍스트 한도(UTF-8, 20,000자)를 여기서 확인한다. 하나라도 보낼 수 없으면 파일 이름이 든 이유를 던진다(일부만 보내지 않는다).
 */
export async function readAttachments(files: File[]): Promise<ChatAttachmentPayload[]> {
  return Promise.all(files.map(async (file) => {
    const checked = checkAttachment(file, 0)
    if (typeof checked === 'string') throw new Error(checked)
    const data = await base64Of(file)
    if (attachmentKind(checked.mediaType) === 'text') {
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
      } catch {
        throw new Error(`${file.name}: UTF-8 텍스트 파일만 보낼 수 있어요. 메모장 등에서 다른 이름으로 저장할 때 인코딩을 UTF-8로 골라 다시 올려 주세요.`)
      }
      if (Array.from(text).length > TEXT_MAX_CHARS) throw new Error(`${file.name}: 텍스트 파일은 ${TEXT_MAX_CHARS.toLocaleString('ko-KR')}자까지 보낼 수 있어요.`)
    }
    return { ...checked, data }
  }))
}
