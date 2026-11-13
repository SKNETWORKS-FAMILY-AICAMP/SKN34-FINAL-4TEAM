import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./media.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** 선택자가 그대로 일치하는 규칙의 선언(없으면 빈 글). */
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1].trim() ?? ''

describe('원고 본문(.manuscript-body)의 서식 모양', () => {
  it('바탕 규칙은 그대로다: 줄바꿈·빈칸을 살리고 행간은 1.9다', () => {
    expect(rule('.manuscript-body')).toBe('white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9;')
  })

  // 작품 관리의 원고 보기는 .ep-reading p{margin:16px 0;line-height:1.8}(0,1,1) 아래에 놓인다. 문단을 p로 그려도 서식 없는 원고의 줄 배치가 달라지지 않아야 한다.
  it('문단·인용은 여백 없이 바깥 행간을 물려받고, 쓰는 화면의 p 규칙보다 앞선다', () => {
    // 이미지를 불러오는 중·실패 문구(p.media-message)는 원고 글이 아니라 전처럼 쓰는 화면의 규칙을 따른다.
    expect(rule('div.manuscript-body :is(p, blockquote):not(.media-message)')).toBe('margin: 0; line-height: inherit;')
    expect(css).not.toMatch(/\.manuscript-body\s+:is\(p, blockquote\)\s*\{/)
  })

  it('소제목은 굵고 한 단계 큰 문단이다', () => {
    expect(rule('div.manuscript-body .manuscript-heading')).toMatch(/font-size: 1\.\d+em; font-weight: 700;/)
  })

  it('인용은 색 띠·배경·기울임 없이 들여쓰기와 본문색 쪽으로 당긴 읽기 보조색으로만 구분한다', () => {
    const quote = rule('div.manuscript-body blockquote')
    expect(quote).toMatch(/padding-inline: 1\.5em;/)
    expect(quote).toMatch(/color: color-mix\(in srgb, var\(--tsub\) 60%, var\(--tfg\)\);/)
    expect(quote).not.toMatch(/border|background|font-style/)
  })

  it('구분선은 한 줄 자리를 차지하는 읽기 보조색 1px 선이다', () => {
    const line = rule('div.manuscript-body hr')
    expect(line).toMatch(/border: 0; border-top: 1px solid var\(--tsub\);/)
    expect(line).not.toMatch(/var\(--t?line\)/)
  })
})
