import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

describe('HTML 데모 탐색 접근성', () => {
  it('현재 탐색 위치와 검색 버튼 이름을 화면 크기와 무관하게 제공한다', () => {
    const dom = new JSDOM(html, {
      url: 'http://localhost/#/rank',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.matchMedia = (() => ({ matches: false, addEventListener() {} }))
        window.scrollTo = () => {}
      },
    })
    try {
      const doc = dom.window.document
      expect(doc.querySelector('.nav')?.getAttribute('aria-label')).toBe('주요 메뉴')
      expect(doc.querySelector('.nav [aria-current="page"]')?.getAttribute('data-go')).toBe('#/rank')
      expect(doc.querySelector('.search')?.getAttribute('aria-label')).toBe('소설·인물·회차 검색')
    } finally {
      dom.window.close()
    }
  })
})

