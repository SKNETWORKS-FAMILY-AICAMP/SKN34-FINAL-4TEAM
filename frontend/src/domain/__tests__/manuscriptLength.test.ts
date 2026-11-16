import { describe, expect, it } from 'vitest'

import { imageMarker } from '../entities/media'
import { BODY_MAX, PUBLISH_MIN, bodyLength, publishBlocker, publishHint, publishRemaining } from '../entities/manuscriptLength'

const ID = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'

describe('원고 글자 수 규칙', () => {
  it('상한은 서버 한도 40,000자, 공개 최소 분량은 5,000자다', () => {
    expect(BODY_MAX).toBe(40000)
    expect(PUBLISH_MIN).toBe(5000)
  })

  it('저장되는 본문 문자열의 길이를 센다: 공백·줄바꿈을 포함하고 이미지 표식은 46자로 센다', () => {
    expect(bodyLength('')).toBe(0)
    expect(bodyLength('가나다 라\n마')).toBe(7)
    // 서버 Manuscript.bodyLength: text.length + images.size * (IMAGE_MARKER_LENGTH - 1) = 표식을 46자로 센 저장 문자열 길이
    expect(imageMarker(ID)).toHaveLength(46)
    expect(bodyLength(`앞\n\n${imageMarker(ID)}\n\n뒤`)).toBe(1 + 2 + 46 + 2 + 1)
  })

  it('공개는 5,000자 이상부터 가능하다: 4,999자는 1자 남고 5,000자는 0자 남는다', () => {
    expect(publishRemaining('')).toBe(5000)
    expect(publishRemaining('가'.repeat(4999))).toBe(1)
    expect(publishRemaining('가'.repeat(5000))).toBe(0)
    expect(publishRemaining('가'.repeat(40000))).toBe(0)
  })

  it('공개를 막는 사유는 현재 글자 수를 알려 주고, 충분하면 비어 있다', () => {
    expect(publishBlocker('가'.repeat(1234))).toBe('공개하려면 본문이 5,000자 이상이어야 해요. 지금은 1,234자예요.')
    expect(publishBlocker('')).toBe('공개하려면 본문이 5,000자 이상이어야 해요. 지금은 0자예요.')
    expect(publishBlocker('가'.repeat(4999))).not.toBe('')
    expect(publishBlocker('가'.repeat(5000))).toBe('')
  })

  it('편집기 하단 안내: 부족하면 남은 글자 수, 충분하면 공개 가능 분량', () => {
    expect(publishHint('가'.repeat(2))).toBe('공개까지 5,000자 중 4,998자 남음')
    expect(publishHint('가'.repeat(4999))).toBe('공개까지 5,000자 중 1자 남음')
    expect(publishHint('가'.repeat(5000))).toBe('공개 가능 분량')
  })
})
