import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../../../styles/storyfork.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// 전역 `:where([data-route-link]){color:inherit;text-decoration:none}`이 바로가기를 본문 글자처럼 보이게 하므로(#961), 시트 안 링크(.note·.reply)와 같은 색·밑줄 규칙에 온보딩 단계 목록도 둔다.
it('온보딩 단계 목록의 바로가기는 시트의 링크 규칙(--pri-ink·밑줄)을 받는다', () => {
  const body = css.match(/\.sheet :is\([^)]*\.onb-steps[^)]*\) a\{([^}]*)\}/)?.[1] ?? ''
  expect(body).toContain('color:var(--pri-ink)')
  expect(body).toContain('text-decoration:underline')
})
