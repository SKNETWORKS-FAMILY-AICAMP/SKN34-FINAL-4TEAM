import { describe, expect, it } from 'vitest'

import { imageMarker } from '../entities/media'
import { bodyToDoc, docToBody } from '../entities/manuscriptDoc'

const A = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const p = (text: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const img = (imageId: string) => ({ type: 'episodeImage', attrs: { imageId } })

describe('본문 문자열 → 편집기 문서', () => {
  it('한 줄이 한 문단이다: 줄바꿈으로 문단을 나눈다', () => {
    expect(bodyToDoc('첫째 문단\n둘째 문단')).toEqual({ type: 'doc', content: [p('첫째 문단'), p('둘째 문단')] })
  })

  it('빈 본문은 빈 문단 하나, 빈 줄은 빈 문단이다', () => {
    expect(bodyToDoc('')).toEqual({ type: 'doc', content: [p('')] })
    expect(bodyToDoc('앞\n\n뒤')).toEqual({ type: 'doc', content: [p('앞'), p(''), p('뒤')] })
    expect(bodyToDoc('끝줄\n')).toEqual({ type: 'doc', content: [p('끝줄'), p('')] })
  })

  it('이미지 표식만 있는 줄은 이미지 블록이고 앞뒤 줄은 문단으로 남는다', () => {
    expect(bodyToDoc(`앞\n\n${imageMarker(A)}\n\n뒤`)).toEqual({ type: 'doc', content: [p('앞'), p(''), img(A), p(''), p('뒤')] })
    expect(bodyToDoc(`${imageMarker(A)}\n${imageMarker(B)}`)).toEqual({ type: 'doc', content: [img(A), img(B)] })
    expect(bodyToDoc(imageMarker(A))).toEqual({ type: 'doc', content: [img(A)] })
  })

  it('줄 가운데 표식이나 앞뒤에 글자·공백이 붙은 표식은 이미지로 바꾸지 않고 글자로 둔다', () => {
    for (const line of [`앞 ${imageMarker(A)} 뒤`, ` ${imageMarker(A)}`, `${imageMarker(A)} `, imageMarker(A).toUpperCase(), '[[image:not-a-uuid]]']) {
      expect(bodyToDoc(line)).toEqual({ type: 'doc', content: [p(line)] })
    }
  })
})

describe('편집기 문서 → 본문 문자열', () => {
  it('문단은 줄바꿈으로 잇고 이미지 블록은 표식 한 줄이 된다', () => {
    expect(docToBody({ type: 'doc', content: [p('앞'), p(''), img(A), p(''), p('뒤')] })).toBe(`앞\n\n${imageMarker(A)}\n\n뒤`)
  })

  it('내용이 없는 문단·content가 빈 배열인 문단·내용이 없는 문서도 읽는다', () => {
    expect(docToBody({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [] }, p('끝')] })).toBe('\n\n끝')
    expect(docToBody({ type: 'doc' })).toBe('')
  })

  it('한 문단 안의 여러 글자 조각은 이어 붙인다', () => {
    expect(docToBody({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '가' }, { type: 'text', text: '나' }] }] })).toBe('가나')
  })
})

describe('왕복 무손실: 본문 → 문서 → 본문', () => {
  const cases: [string, string][] = [
    ['빈 본문', ''],
    ['줄바꿈만', '\n'],
    ['앞뒤 줄바꿈', '\n앞\n'],
    ['빈 문단 여러 개', '\n\n\n'],
    ['한 줄', '이야기를 이어 써 보세요'],
    ['문단 사이 빈 줄', '첫째\n\n둘째\n셋째'],
    ['앞뒤 공백·탭', '  들여쓰기\t끝  \n\t둘째'],
    ['이미지 앞뒤 빈 줄', `앞\n\n${imageMarker(A)}\n\n뒤`],
    ['이미지가 맨 앞·맨 끝', `${imageMarker(A)}\n본문\n${imageMarker(B)}`],
    ['이미지가 이어진 줄', `${imageMarker(A)}\n${imageMarker(B)}\n${imageMarker(A)}`],
    ['대문자 식별자', `앞\n${imageMarker(A.toUpperCase())}\n뒤`],
    ['줄 가운데 표식', `앞 ${imageMarker(A)} 뒤`],
    ['대문자 image 표식(이미지가 아니라 글자)', `[[IMAGE:${A}]]`],
    ['표식 앞뒤 공백', ` ${imageMarker(A)} `],
    ['CRLF', '가\r\n나\r\n'],
    ['이모지·특수문자', '😀 한글 ‘따옴표’ <b>태그</b> & [[대괄호]]'],
  ]
  it.each(cases)('%s', (_name, body) => {
    expect(docToBody(bodyToDoc(body))).toBe(body)
  })

  it('40,000자 본문도 그대로 돌아온다', () => {
    const lines = ('가'.repeat(99) + '\n').repeat(400)
    expect(lines).toHaveLength(40000)
    expect(docToBody(bodyToDoc(lines))).toBe(lines)
    const withImage = ('가'.repeat(99) + '\n').repeat(399) + '가'.repeat(53) + '\n' + imageMarker(B)
    expect(withImage).toHaveLength(40000)
    expect(docToBody(bodyToDoc(withImage))).toBe(withImage)
  })
})
