// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { CardMarkdown } from './CardMarkdown'

afterEach(cleanup)

const draw = (text: string) => render(<CardMarkdown text={text} />).container

it('본문의 제목은 페이지 제목과 겹치지 않게 h3 이하로 낮춰 그린다', () => {
  const root = draw('# 하나\n\n## 둘\n\n### 셋\n\n#### 넷\n\n##### 다섯\n\n###### 여섯')
  expect(Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'), (h) => [h.tagName, h.textContent])).toEqual([
    ['H3', '하나'], ['H3', '둘'], ['H4', '셋'], ['H5', '넷'], ['H6', '다섯'], ['H6', '여섯'],
  ])
})

it('표·목록·취소선을 그리고 물결표 하나는 취소선으로 보지 않는다', () => {
  const root = draw('| 이름 | 나이 |\n| --- | --- |\n| 하린 | 19 |\n\n- 첫째\n- ~~둘째~~\n\n1~3화와 5~7화')
  expect(Array.from(root.querySelectorAll('th'), (e) => e.textContent)).toEqual(['이름', '나이'])
  expect(Array.from(root.querySelectorAll('td'), (e) => e.textContent)).toEqual(['하린', '19'])
  expect(Array.from(root.querySelectorAll('ul > li'), (e) => e.textContent)).toEqual(['첫째', '둘째'])
  expect(Array.from(root.querySelectorAll('del'), (e) => e.textContent)).toEqual(['둘째']) // 1~3화·5~7화의 ~가 사이 글자를 긋지 않는다
  expect(root.textContent).toContain('1~3화와 5~7화')
})

it('원시 HTML은 요소로 그리지 않고 글자 그대로 보인다', () => {
  const root = draw('앞\n\n<script>window.hacked = 1</script>\n\n<img src="https://example.test/x.png" onerror="window.hacked = 2">\n\n<b>굵게?</b> 뒤')
  expect(root.querySelector('script, img, b')).toBeNull()
  expect(root.textContent).toContain('<script>window.hacked = 1</script>')
  expect(root.textContent).toContain('<b>굵게?</b>')
})

it('링크는 새 탭에서 열고 안전하지 않은 주소는 링크로 만들지 않는다', () => {
  draw('[달무리](https://example.test/a) [나쁨](javascript:window.hacked=1) <https://example.test/auto>')
  const link = screen.getByRole('link', { name: '달무리' })
  expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual(['https://example.test/a', '_blank', 'noopener noreferrer'])
  expect(screen.getByRole('link', { name: 'https://example.test/auto' }).getAttribute('target')).toBe('_blank')
  expect(screen.queryByRole('link', { name: '나쁨' })).toBeNull()
  expect(document.body.textContent).toContain('나쁨')
})

it('이미지는 불러오지 않고 대체 글자만 보인다', () => {
  const root = draw('앞 ![달무리 지도](https://example.test/map.png) 뒤')
  expect(root.querySelector('img')).toBeNull()
  expect(root.textContent?.trim()).toBe('앞 달무리 지도 뒤')
})

it('글자 그대로 쓴 줄바꿈은 한 문단 안에 그대로 남는다', () => {
  const root = draw('첫 줄\n둘째 줄\n\n셋째 문단')
  expect(Array.from(root.querySelectorAll('p'), (p) => p.textContent)).toEqual(['첫 줄\n둘째 줄', '셋째 문단'])
})
