// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { TEXT_MAX_CHARS } from '../../../domain/entities/chatAttachment'
import { readAttachments } from './readAttachments'

const base64 = (bytes: number[] | Uint8Array) => btoa(String.fromCharCode(...bytes))

describe('readAttachments(#617)', () => {
  it('고른 파일을 이름·형식·Base64(data URL 접두어 없이)로 읽는다', async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71])], '지도.png', { type: 'image/png' })
    const note = new File(['# 설정\n북문은 밤에 닫힌다.'], '메모.md', { type: '' })
    const read = await readAttachments([image, note])
    expect(read[0]).toEqual({ name: '지도.png', mediaType: 'image/png', data: base64([137, 80, 78, 71]) })
    expect(read[1].mediaType).toBe('text/markdown')
    expect(new TextDecoder().decode(Uint8Array.from(atob(read[1].data), (c) => c.charCodeAt(0)))).toBe('# 설정\n북문은 밤에 닫힌다.')
  })

  it('텍스트가 20,000자면 보내고 넘으면 파일 이름과 함께 거절한다(글자 수는 코드 포인트로 센다)', async () => {
    await expect(readAttachments([new File(['가'.repeat(TEXT_MAX_CHARS)], '긴.txt', { type: 'text/plain' })])).resolves.toHaveLength(1)
    await expect(readAttachments([new File(['😀'.repeat(TEXT_MAX_CHARS)], '이모지.txt', { type: 'text/plain' })])).resolves.toHaveLength(1)
    await expect(readAttachments([new File(['가'.repeat(TEXT_MAX_CHARS + 1)], '긴.txt', { type: 'text/plain' })]))
      .rejects.toThrow('긴.txt: 텍스트 파일은 20,000자까지 보낼 수 있어요.')
  })

  it('UTF-8이 아닌 텍스트(윈도우 ANSI·CP949 등)는 파일 이름과 함께 거절하고 UTF-8로 다시 저장하는 방법을 알린다', async () => {
    await expect(readAttachments([new File([new Uint8Array([0xff, 0xfe, 0x41])], '옛.txt', { type: 'text/plain' })]))
      .rejects.toThrow('옛.txt: UTF-8 텍스트 파일만 보낼 수 있어요. 메모장 등에서 다른 이름으로 저장할 때 인코딩을 UTF-8로 골라 다시 올려 주세요.')
  })

  it('보낼 수 없는 형식은 읽지 않고 그 이유를 던진다', async () => {
    await expect(readAttachments([new File(['x'], '움짤.gif', { type: 'image/gif' })])).rejects.toThrow('지원하지 않는 형식')
  })
})
