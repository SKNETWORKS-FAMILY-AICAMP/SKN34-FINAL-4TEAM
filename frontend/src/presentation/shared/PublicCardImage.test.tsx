// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { PublicCardImage } from './PublicCardImage'

afterEach(cleanup)

it('공개 이미지 주소를 그대로 읽는 이미지이고 대체 글은 카드 제목 이미지이며 화면에 보일 때만 읽는다', () => {
  render(<PublicCardImage src="/api/v1/public/world-studios/w/card-images/i" title="하린" className="x" />)
  const image = screen.getByRole('img', { name: '하린 이미지' })
  expect([image.getAttribute('src'), image.getAttribute('loading'), image.className]).toEqual(['/api/v1/public/world-studios/w/card-images/i', 'lazy', 'x'])
})

it('읽지 못하면(공개 중단·삭제·네트워크) 깨진 그림 대신 감춘다', () => {
  render(<PublicCardImage src="/a" title="하린" />)
  fireEvent.error(screen.getByRole('img', { name: '하린 이미지' }))
  expect(screen.queryByRole('img')).toBeNull()
})

it('다른 이미지로 바뀌면 이전 이미지의 실패를 이어받지 않고 다시 보인다', () => {
  const { rerender } = render(<PublicCardImage src="/a" title="하린" />)
  fireEvent.error(screen.getByRole('img', { name: '하린 이미지' }))
  rerender(<PublicCardImage src="/b" title="하린" />)
  expect(screen.getByRole('img', { name: '하린 이미지' }).getAttribute('src')).toBe('/b')
})
