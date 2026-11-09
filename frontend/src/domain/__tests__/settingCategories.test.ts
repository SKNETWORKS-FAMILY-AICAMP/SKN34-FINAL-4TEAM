import { expect, it } from 'vitest'
import { settingCategories } from '../entities/content'

it('분류가 없는 샘플을 기타로 편집할 수 있도록 선택지를 제공한다', () => {
  expect(settingCategories).toContain('기타')
  expect(settingCategories).not.toContain('사건')
})
