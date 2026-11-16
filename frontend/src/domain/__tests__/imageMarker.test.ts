import { describe, expect, it } from 'vitest'

import { imageMarker, removeImageMarker } from '../entities/media'

const A = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'

describe('본문에서 이미지 표식 빼기', () => {
  it('에디터가 넣은 앞뒤 빈 줄과 함께 지우고 문단 사이 빈 줄 하나만 남긴다', () => {
    expect(removeImageMarker(`앞 문단\n\n${imageMarker(A)}\n\n뒤 문단`, A)).toBe('앞 문단\n\n뒤 문단')
  })

  it('본문 맨 앞이나 맨 끝의 표식은 남는 빈 줄 없이 지운다', () => {
    expect(removeImageMarker(`${imageMarker(A)}\n\n본문`, A)).toBe('본문')
    expect(removeImageMarker(`본문\n\n${imageMarker(A)}`, A)).toBe('본문')
    expect(removeImageMarker(imageMarker(A), A)).toBe('')
  })

  it('다른 이미지의 표식과 본문 글자는 건드리지 않고, 같은 이미지가 여러 번 있으면 모두 지운다', () => {
    const body = `${imageMarker(A)}\n\n첫째\n\n${imageMarker(B)}\n\n둘째\n\n${imageMarker(A)}\n\n끝`
    expect(removeImageMarker(body, A)).toBe(`첫째\n\n${imageMarker(B)}\n\n둘째\n\n끝`)
    expect(removeImageMarker(`${imageMarker(A)}\n\n${imageMarker(B)}\n\n본문`, B)).toBe(`${imageMarker(A)}\n\n본문`)
  })

  it('줄 가운데 표식은 줄바꿈을 만들지 않고, 대소문자를 가리지 않으며, 표식이 없으면 같은 문자열을 돌려준다', () => {
    expect(removeImageMarker(`앞 ${imageMarker(A)} 뒤`, A)).toBe('앞  뒤')
    expect(removeImageMarker(`앞\n\n${imageMarker(A.toUpperCase())}\n\n뒤`, A)).toBe('앞\n\n뒤')
    const body = `앞\n\n${imageMarker(B)}\n\n뒤`
    expect(removeImageMarker(body, A)).toBe(body)
  })

  it('식별자에 정규식 문자가 있어도 다른 표식을 지우지 않는다', () => {
    const body = `앞\n\n${imageMarker(A)}\n\n뒤`
    expect(removeImageMarker(body, '.*')).toBe(body)
  })
})
