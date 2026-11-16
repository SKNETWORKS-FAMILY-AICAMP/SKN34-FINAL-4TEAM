import { describe, expect, it } from 'vitest'

import { popLeft } from './sentencePop'

describe('문장 팝업의 가로 위치', () => {
  it('들어갈 자리가 있으면 고른 문장의 왼쪽에 맞춘다', () => {
    expect(popLeft(200, 338, 1280)).toBe(200)
  })

  it('오른쪽으로 넘치면 팝업의 실제 폭만큼만 당겨 화면 끝에 여백을 남긴다', () => {
    expect(popLeft(1100, 338, 1280)).toBe(930)
    // 비로그인 정본처럼 버튼 글자가 길어 폭이 넓으면 그만큼 더 당긴다(고정 폭을 가정하지 않는다).
    expect(popLeft(1100, 530, 1280)).toBe(738)
  })

  it('좁은 화면에서는 왼쪽 여백에 붙이고, 폭이 화면을 채워도 양쪽 여백이 같다', () => {
    expect(popLeft(40, 338, 360)).toBe(12)
    expect(popLeft(40, 336, 360)).toBe(12)
    expect(popLeft(4, 100, 360)).toBe(12)
  })
})
