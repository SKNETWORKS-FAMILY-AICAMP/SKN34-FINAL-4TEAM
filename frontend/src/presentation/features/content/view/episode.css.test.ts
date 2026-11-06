import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./episode.css', import.meta.url), 'utf8')
const sizes = (re: RegExp) => [...css.matchAll(re)].map((m) => Number(m[1]))

describe('episode.css 접근성 계약', () => {
  it('글자 크기는 모두 12px 이상이고 font-size:0으로 숨기지 않는다', () => {
    // font 축약형은 `font:11px var(--mono)`·`font:700 26px var(--story)`처럼 크기 앞에 굵기가 올 수 있다.
    const small = [...sizes(/font-size:\s*([\d.]+)px/g), ...sizes(/font:\s*(?:[\w-]+\s+)*?([\d.]+)px/g)].filter((px) => px < 12)
    expect(small).toEqual([])
    expect(css).not.toMatch(/font-size:\s*0(?![\d.])/)
  })

  it('오류 안내는 light-dark로 다크 모드 색을 따로 갖는다 (직접 선택과 OS 설정 모두 color-scheme을 따른다)', () => {
    const alert = css.match(/\.ep-alert\{([^}]*)\}/)?.[1] ?? ''
    for (const prop of ['background', 'color', 'border']) expect(alert, prop).toMatch(new RegExp(`${prop}:[^;]*light-dark\\(`))
  })

  it('좁은 화면에서 스튜디오 이름은 시각적으로만 숨기고 스크린리더에는 남긴다', () => {
    expect(css).toMatch(/\.ep-top-label\s*\{[^}]*clip-path:\s*inset\(50%\)/)
  })
})
