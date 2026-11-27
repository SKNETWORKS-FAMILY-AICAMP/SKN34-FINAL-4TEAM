import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../../../styles/storyfork.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// 전역 `:where([data-route-link]){color:inherit;text-decoration:none}`이 바로가기를 본문 글자처럼 보이게 하므로(#961), 시트 안 링크(.note·.reply)와 같은 색·밑줄 규칙에 온보딩 단계 목록도 둔다.
it('온보딩 단계 목록의 바로가기는 시트의 링크 규칙(--pri-ink·밑줄)을 받는다', () => {
  const body = css.match(/\.sheet :is\([^)]*\.onb-steps[^)]*\) a\{([^}]*)\}/)?.[1] ?? ''
  expect(body).toContain('color:var(--pri-ink)')
  expect(body).toContain('text-decoration:underline')
})

// 바로가기 글이 줄 끝에서 '홈 / 목록 보기'처럼 갈라지지 않게 한 덩어리로 두고, 단계 제목은 한 줄을 차지해 훑어보기 쉽게 한다(UX 개선).
it('바로가기는 줄바꿈하지 않고 단계 제목은 한 줄을 차지한다', () => {
  expect(css.match(/\.onb-steps a\{([^}]*)\}/)?.[1] ?? '').toContain('white-space:nowrap')
  expect(css.match(/\.onb-steps b\{([^}]*)\}/)?.[1] ?? '').toContain('display:block')
})

// 아래 줄은 왼쪽에 '다음부터 보지 않기' 선택, 오른쪽 끝에 주 버튼이다. 좁으면 줄을 바꾸되 주 버튼은 오른쪽에 남는다.
it('아래 줄은 선택과 주 버튼을 양 끝에 둔다', () => {
  const body = css.match(/\.onb-foot\{([^}]*)\}/)?.[1] ?? ''
  expect(body).toContain('justify-content:space-between')
  expect(body).toContain('flex-wrap:wrap')
})
