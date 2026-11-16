import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../../../styles/storyfork.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** 선택자가 그대로 일치하는 첫 규칙의 선언(없으면 빈 글). */
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''
const FORMAT_RULES = ['.text :is(p,blockquote)', '.text h3', '.text>h3:first-child', '.text blockquote', '.text hr', '.text figure', '.text figure .stored-image', '.text .media-message']

describe('독서 화면 본문의 원고 기본 서식 모양 (storyfork.css)', () => {
  it('본문 폭·글자 크기·행간·문단 간격은 서식을 들이기 전 값 그대로다', () => {
    expect(rule('.page')).toBe('max-width:720px;margin:0 auto;padding:56px 24px 40px')
    expect(rule('.text')).toBe('font-family:var(--tfont);font-size:var(--fs,19px);line-height:2.05;word-break:keep-all')
    expect(rule('.text p')).toBe('margin:0 0 1.15em')
  })

  it('문단·인용 안의 줄바꿈은 줄바꿈으로 보이고 이어진 빈칸은 전처럼 하나로 합친다', () => {
    expect(rule('.text :is(p,blockquote)')).toBe('white-space:pre-line')
  })

  it('소제목은 본문 글자 크기에 비례해 한 단계 크고 위 간격이 아래 간격보다 넓다', () => {
    const [, size] = rule('.text h3').match(/font-size:([\d.]+)em/) ?? []
    const [, above, below] = rule('.text h3').match(/margin:([\d.]+)em 0 ([\d.]+)em/) ?? []
    expect(Number(size)).toBeGreaterThan(1)
    expect(Number(above)).toBeGreaterThan(Number(below))
    // 본문 맨 앞의 소제목은 안내 상자 바로 아래라 위 간격을 더하지 않는다.
    expect(rule('.text>h3:first-child')).toBe('margin-top:0')
  })

  it('인용은 색 띠·배경·기울임 없이 들여쓰기와 본문색 쪽으로 당긴 읽기 보조색으로만 구분하고 문단과 같은 간격을 쓴다', () => {
    const quote = rule('.text blockquote')
    expect(quote).toMatch(/margin:0 0 1\.15em/)
    expect(quote).toMatch(/padding:0 1\.5em/)
    // --tsub만으로도 보기 설정 5종·라이트/다크에서 4.5:1 이상이고(reader-tokens.css.test.ts의 --faint) 본문색을 섞으면 더 높다(최저 6.90:1).
    expect(quote).toMatch(/color:color-mix\(in srgb,var\(--tsub\) 60%,var\(--tfg\)\)/)
    expect(quote).not.toMatch(/border|background|font-style/)
  })

  it('구분선은 읽기 보조색 1px의 짧은 가운데 선이다(본문 배경에서 비글자 3:1 이상, 최저 4.62:1)', () => {
    const line = rule('.text hr')
    expect(line).toMatch(/border:0;border-top:1px solid var\(--tsub\)/)
    expect(line).toMatch(/margin:[\d.]+em auto/)
    expect(line).not.toMatch(/var\(--tline\)/)
  })

  it('본문 이미지는 가운데에 두고 불러오는 중·실패 문구는 읽기 보조색의 작은 UI 글자다', () => {
    expect(rule('.text figure')).toMatch(/margin:[\d.]+em 0/)
    expect(rule('.text figure .stored-image')).toBe('margin-inline:auto')
    expect(rule('.text .media-message')).toMatch(/color:var\(--tsub\)/)
  })

  it('서식 규칙은 읽기 토큰만 쓰고 새 색·그림자·움직임을 들이지 않는다', () => {
    for (const selector of FORMAT_RULES) {
      const body = rule(selector)
      expect(body, selector).not.toBe('')
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|shadow|animation|transition|var\(--(?!t|ui\))/i)
    }
  })
})
