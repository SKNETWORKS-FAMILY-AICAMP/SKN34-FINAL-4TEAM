import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./publicWiki.css', import.meta.url), 'utf8')
/** 선택자 블록 하나의 선언부(줄머리나 앞 규칙의 닫는 중괄호 뒤에서 시작하는 그 선택자만). */
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''

it('오른쪽 정보 상자(.nw-info, float: right)는 카드(.nw)와 문서(.nw-doc)가 float를 담아(flow-root) 본문이 짧아도 흰 카드 아래로 삐져나오지 않는다', () => {
  expect(rule('.nw-info')).toMatch(/float:\s*right/)
  // 카드 페이지는 정보 상자가 .nw-doc 밖(카드의 직접 자식)이라 .nw가, 독자 설정 위키·세계관 개요는 정보 상자가 .nw-doc 안이라 .nw-doc가 담는다.
  expect(rule('.nw')).toMatch(/display:\s*flow-root/)
  expect(rule('.nw-doc')).toMatch(/display:\s*flow-root/)
})
