import { expect, it } from 'vitest'
import { savedVersionLabel } from '../entities/content'

it('같은 회차의 저장 순서로 표시하고 모르는 버전 ID는 노출하지 않는다', () => {
  const rows = [{id:'a'}, {id:'b'}]
  expect(savedVersionLabel(rows, 'b')).toBe('저장 버전 2')
  expect(savedVersionLabel(rows, 'unknown')).toBe('저장 버전 미확인')
})

it('versionId가 없는 옛 응답의 공개 회차도 번호를 지어내지 않고 미확인으로 보인다', () => {
  expect(savedVersionLabel([{id:'a'}], undefined)).toBe('저장 버전 미확인')
})
