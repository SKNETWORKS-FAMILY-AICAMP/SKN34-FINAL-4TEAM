import { describe, expect, it } from 'vitest'
import { compareText } from '../entities/versionComparison'

describe('저장 원고 비교', () => {
  it('같은 원고와 빈 원고를 변경 없음으로 표시한다', () => {
    expect(compareText('같은 원고\n', '같은 원고\n').parts).toEqual([{ kind: 'same', text: '같은 원고\n' }])
    expect(compareText('', '').parts).toEqual([])
  })
  it('서로 떨어진 수정 사이의 유지된 문단을 보존한다', () => {
    expect(compareText('처음\n이전\n유지\n끝', '처음\n수정\n유지\n추가\n끝').parts).toEqual([
      { kind: 'same', text: '처음\n' }, { kind: 'removed', text: '이전\n' },
      { kind: 'added', text: '수정\n' }, { kind: 'same', text: '유지\n' },
      { kind: 'added', text: '추가\n' }, { kind: 'same', text: '끝' },
    ])
  })
  it.each([
    ['', '새 원고'], ['삭제\n', ''], ['가\r\n나\n', '가\n나'],
    ['😀\n[[image:abc]]\n<script>', '😀\n[[image:def]]\n<script>'],
    ['반복\n반복\n끝', '반복\n끝'],
  ])('줄바꿈·이미지 참조·문자를 손실 없이 보존한다', (before, after) => {
    const { parts } = compareText(before, after)
    expect(parts.filter(p => p.kind !== 'added').map(p => p.text).join('')).toBe(before)
    expect(parts.filter(p => p.kind !== 'removed').map(p => p.text).join('')).toBe(after)
  })
  it('줄 수가 많은 원고는 메모리를 제한하고 변경 구간을 묶어 비교한다', () => {
    const before = '가\n'.repeat(20000), after = '나\n'.repeat(20000)
    const result = compareText(before, after)
    expect(result.grouped).toBe(true)
    expect(result.parts).toEqual([{ kind: 'removed', text: before }, { kind: 'added', text: after }])
  })
})
