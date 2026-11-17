// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { seedWorks } from '../../data/mock/seed'
import type { Work } from '../../domain/entities/work'
import { Cov, CoverOf } from './art'

afterEach(cleanup)

/** 한지 테마에 한자 제목이 있는 시드 작품: 예전에는 테마 그림에 한자 제목까지 얹던 표지다. */
const work = (coverImg?: string | null): Work => {
  const base = seedWorks().find((w) => w.id === 'guunmong')
  if (!base) throw new Error('시드 작품이 없어요')
  return { ...base, coverImg }
}

it('올린 표지가 없는 작품은 테마 그림이 아니라 기본 표지다', () => {
  const { container } = render(<CoverOf w={work()} />)
  expect(container.querySelector('svg')).toBeNull()
  expect(container.querySelector('img.cimg')?.getAttribute('src')).toBe('/default-work-cover.svg')
})

it('올린 표지가 있는 작품은 그 표지다', () => {
  const { container } = render(<CoverOf w={work('data:image/jpeg;base64,COVER')} />)
  expect(container.querySelector('img.cimg')?.getAttribute('src')).toBe('data:image/jpeg;base64,COVER')
})

it('책 카드(Cov)도 같은 규칙이고 태그·좋아요는 표지 위에 그대로 얹는다', () => {
  const { container } = render(<Cov w={work()} likes />)
  expect(container.querySelector('.cov svg')).toBeNull()
  expect(container.querySelector('.cov img.cimg')?.getAttribute('src')).toBe('/default-work-cover.svg')
  expect(container.querySelector('.cov .tg')).not.toBeNull()
  expect(container.querySelector('.cov .lk')).not.toBeNull()
})
