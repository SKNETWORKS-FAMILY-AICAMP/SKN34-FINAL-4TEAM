import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('./writing.css', import.meta.url), 'utf8')

it('600px 이하 집필실은 상단 바가 문서와 함께 올라가고 본문 툴바만 화면 맨 위에 붙는다 (세계관 설정 편집 화면은 그대로)', () => {
  // 상단 바는 오른쪽 묶음이 다음 줄로 접혀 3줄(≈180px)이 되는데 sticky라 원고 면적의 약 4분의 1을 스크롤 내내 가렸다. 601~900px은 한 줄에 가까워 그대로 붙어 있다.
  const narrow = css.match(/@media \(max-width: 600px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  expect(narrow).toMatch(/\.writing-studio:not\(\.world-card-studio\) \.sbar \{\s*position:\s*static;?\s*\}/)
  // 상단 바가 문서와 함께 올라가면 툴바가 붙을 자리는 화면 맨 위다(900px 이하 기본값 --writing-bar-height는 바가 붙어 있을 때의 자리).
  expect(narrow).toMatch(/\.writing-studio:not\(\.world-card-studio\) \{\s*--writing-toolbar-top:\s*0px;?\s*\}/)
})
