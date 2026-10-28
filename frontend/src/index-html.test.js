import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

describe('HTML 데모 탐색 접근성', () => {
  it('데모 역할 선택 후에도 선택 버튼에 키보드 초점이 남는다', () => {
    const dom = new JSDOM(html, {
      url: 'http://localhost/#/login', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(window) { window.matchMedia = () => ({ matches: false, addEventListener() {} }); window.scrollTo = () => {} },
    })
    try {
      const doc = dom.window.document
      doc.querySelector('[data-role="admin"]').click()
      expect(doc.activeElement).toBe(doc.querySelector('[data-role="admin"]'))
      expect(doc.activeElement.getAttribute('aria-pressed')).toBe('true')
    } finally { dom.window.close() }
  })

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

describe('문의 처리 데모', () => {
  it('관리자 개요에서 대기 문의와 신고 건수를 보여주고 해당 메뉴로 이동한다', async () => {
    const dom = new JSDOM(html, {
      url: 'http://localhost/#/home', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(window) { window.matchMedia = () => ({ matches: false, addEventListener() {} }); window.scrollTo = () => {} },
    })
    try {
      const { document: doc, __SF } = dom.window
      __SF.S.inq.push({ t: '기타', s: '제목', b: '내용', d: '2026.10.28', st: '답변 대기' })
      __SF.S.role = 'admin'
      dom.window.location.hash = '#/admin'
      await new Promise(resolve => setTimeout(resolve, 250))
      const link = doc.querySelector('.priority-links [data-go="#/admin?tab=feedback"]')
      expect(link.textContent).toContain('1')
      link.click()
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(doc.querySelector('h1').textContent).toBe('제보·문의')
    } finally { dom.window.close() }
  })

  it('관리자 답변을 사용자에게 표시하고 활동 로그에 남긴다', async () => {
    const dom = new JSDOM(html, {
      url: 'http://localhost/#/me/inquiry', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(window) { window.matchMedia = () => ({ matches: false, addEventListener() {} }); window.scrollTo = () => {} },
    })
    try {
      const { document: doc, __SF } = dom.window
      doc.querySelector('#iqs').value = '작품 문의'
      doc.querySelector('#iqb').value = '공개는 어떻게 하나요?'
      doc.querySelector('#iqf').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      __SF.S.role = 'admin'
      dom.window.location.hash = '#/admin?tab=feedback'
      await new Promise(resolve => setTimeout(resolve, 250))
      const answer = doc.querySelector('[data-inquiry-answer]')
      expect(answer).not.toBeNull()
      expect(doc.querySelector('#sid').textContent).toContain('관리자 · 제보·문의')
      doc.querySelector('[data-inquiry-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      expect(__SF.S.inq[0].st).toBe('답변 대기')
      answer.value = '작품 설정에서 확인해 주세요.'
      doc.querySelector('[data-inquiry-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      expect(__SF.S.inq[0].st).toBe('답변 완료')
      expect(__SF.S.admin.audit[0].action).toBe('문의 답변')
      __SF.S.role = 'user'
      dom.window.location.hash = '#/me/inquiry'
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(doc.body.textContent).toContain('작품 설정에서 확인해 주세요.')
      expect(doc.body.textContent).toContain('답변 완료')
    } finally { dom.window.close() }
  })
})

