import { expect, it } from 'vitest'

import { coverSrc, DEFAULT_COVER } from './cover'

it('올린 표지가 없으면 기본 표지, 있으면 올린 표지를 쓴다', () => {
  expect(DEFAULT_COVER).toBe('/default-work-cover.svg')
  for (const none of [undefined, null, '']) expect(coverSrc(none), String(none)).toBe('/default-work-cover.svg')
  expect(coverSrc('blob:uploaded')).toBe('blob:uploaded')
  expect(coverSrc('/api/v1/public/world-studios/w1/cover')).toBe('/api/v1/public/world-studios/w1/cover')
})
