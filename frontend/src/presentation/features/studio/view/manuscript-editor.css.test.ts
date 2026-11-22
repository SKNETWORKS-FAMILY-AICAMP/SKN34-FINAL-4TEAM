import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./manuscript-editor.css', import.meta.url), 'utf8')
/** 한 줄에 한 규칙인 이 파일에서 '줄 처음의 선택자 {' 규칙의 선언부(미디어 쿼리 안의 들여쓴 규칙은 건드리지 않는다). */
const rule = (selector: string) => {
  const start = css.indexOf('\n' + selector + ' {')
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}
const button = '.manuscript-editor .writing-body .toastui-editor-defaultUI-toolbar button'

it('툴바 아이콘은 본문보다 한 단계 흐리게(.72) 두되 Toast의 비활성(.3)과 켜진 상태(.active)는 덮지 않고, hover·초점에서는 또렷하다', () => {
  // .72는 라이트 3.6:1(아이콘 #555)·다크 8.4:1(#EEE)로 비문자 대비 3:1을 지킨다. 기본 규칙에 opacity를 두면 Toast의 비활성 규칙(.3)을 이겨 잠긴 버튼이 구분되지 않는다.
  expect(rule(button + ':not(:disabled, .active)')).toMatch(/opacity:\s*\.72/)
  expect(rule(button)).not.toMatch(/opacity/)
  expect(rule(button + ':not(:disabled):hover')).toMatch(/opacity:\s*1(?![\d.])/)
  expect(rule(button + ':focus-visible')).toMatch(/opacity:\s*1(?![\d.])/)
})
