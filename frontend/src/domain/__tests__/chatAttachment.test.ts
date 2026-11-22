import { describe, expect, it } from 'vitest'
import { ATTACHMENT_MAX, attachmentKind, checkAttachment, IMAGE_MAX_BYTES } from '../entities/chatAttachment'

const file = (name: string, type: string, size = 1000) => ({ name, type, size })

// 집필 AI 채팅 첨부(#617): 한 메시지에 3개까지, 이미지는 PNG·JPEG·WEBP 5MB 이하, 텍스트는 .txt·.md. 20,000자 검사는 읽은 뒤(readAttachments)에 한다.
describe('checkAttachment', () => {
  it('PNG·JPEG·WEBP 이미지는 브라우저가 알려 준 형식으로 받는다', () => {
    expect(checkAttachment(file('지도.png', 'image/png'), 0)).toEqual({ name: '지도.png', mediaType: 'image/png' })
    expect(checkAttachment(file('표지.jpg', 'image/jpeg'), 1)).toEqual({ name: '표지.jpg', mediaType: 'image/jpeg' })
    expect(checkAttachment(file('표지.webp', 'image/webp'), 2)).toEqual({ name: '표지.webp', mediaType: 'image/webp' })
  })

  it('텍스트는 file.type이 아니라 확장자로 정한다: Windows는 .md의 type이 빈 문자열이다', () => {
    expect(checkAttachment(file('메모.md', ''), 0)).toEqual({ name: '메모.md', mediaType: 'text/markdown' })
    expect(checkAttachment(file('메모.MD', 'text/x-markdown'), 0)).toEqual({ name: '메모.MD', mediaType: 'text/markdown' })
    expect(checkAttachment(file('메모.txt', 'text/plain'), 0)).toEqual({ name: '메모.txt', mediaType: 'text/plain' })
    expect(checkAttachment(file('메모.txt', ''), 0)).toEqual({ name: '메모.txt', mediaType: 'text/plain' })
  })

  it.each([
    ['GIF(움직이는 그림은 AI가 거절한다)', file('움짤.gif', 'image/gif')],
    ['SVG', file('로고.svg', 'image/svg+xml')],
    ['PDF', file('원고.pdf', 'application/pdf')],
    ['docx', file('원고.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')],
    ['확장자 없는 파일', file('README', '')],
    ['.md 같은 이름의 폴더·실행 파일', file('run.md.exe', 'application/octet-stream')],
  ])('지원하지 않는 형식(%s)은 파일 이름과 이유를 돌려준다', (_name, picked) => {
    const reason = checkAttachment(picked, 0)
    expect(typeof reason).toBe('string')
    expect(reason).toContain(picked.name)
    expect(reason).toContain('지원하지 않는 형식')
  })

  it('5MB를 넘으면 거절하고 정확히 5MB는 받는다(텍스트도 같은 크기 한도다)', () => {
    expect(checkAttachment(file('큰.png', 'image/png', IMAGE_MAX_BYTES), 0)).toEqual({ name: '큰.png', mediaType: 'image/png' })
    expect(checkAttachment(file('큰.png', 'image/png', IMAGE_MAX_BYTES + 1), 0)).toBe('큰.png: 5MB 이하 파일만 첨부할 수 있어요.')
    expect(checkAttachment(file('큰.txt', 'text/plain', IMAGE_MAX_BYTES + 1), 0)).toBe('큰.txt: 5MB 이하 파일만 첨부할 수 있어요.')
  })

  it('이미 3개를 골랐으면 더 받지 않는다', () => {
    expect(ATTACHMENT_MAX).toBe(3)
    expect(checkAttachment(file('넷째.png', 'image/png'), 3)).toBe('넷째.png: 한 메시지에 3개까지만 첨부할 수 있어요.')
  })

  it('형식이 틀린 파일은 개수가 찼어도 형식 문제를 먼저 알린다', () => {
    expect(checkAttachment(file('움짤.gif', 'image/gif'), 3)).toContain('지원하지 않는 형식')
  })
})

describe('attachmentKind', () => {
  it('이미지 형식은 image, 텍스트 형식은 text', () => {
    expect(attachmentKind('image/webp')).toBe('image')
    expect(attachmentKind('text/markdown')).toBe('text')
  })
})
